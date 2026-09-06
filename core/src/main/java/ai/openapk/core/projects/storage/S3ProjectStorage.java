package ai.openapk.core.projects.storage;

import ai.openapk.core.config.OpenApkProperties;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.stereotype.Component;
import software.amazon.awssdk.core.sync.RequestBody;
import software.amazon.awssdk.core.sync.ResponseTransformer;
import software.amazon.awssdk.services.s3.S3Client;
import software.amazon.awssdk.services.s3.model.Delete;
import software.amazon.awssdk.services.s3.model.DeleteObjectRequest;
import software.amazon.awssdk.services.s3.model.DeleteObjectsRequest;
import software.amazon.awssdk.services.s3.model.GetObjectRequest;
import software.amazon.awssdk.services.s3.model.HeadObjectRequest;
import software.amazon.awssdk.services.s3.model.ListObjectsV2Request;
import software.amazon.awssdk.services.s3.model.NoSuchKeyException;
import software.amazon.awssdk.services.s3.model.ObjectIdentifier;
import software.amazon.awssdk.services.s3.model.PutObjectRequest;
import software.amazon.awssdk.services.s3.model.S3Object;
import software.amazon.awssdk.services.s3.presigner.S3Presigner;
import software.amazon.awssdk.services.s3.presigner.model.GetObjectPresignRequest;

import java.io.IOException;
import java.io.InputStream;
import java.net.URI;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Duration;
import java.time.Instant;
import java.util.Comparator;
import java.util.List;
import java.util.UUID;
import java.util.stream.Stream;

/**
 * S3-backed {@link ProjectStorage} with a local per-task cache. Activated by
 * {@code openapk.storage.backend=s3}.
 *
 * <p>The workspace dir doubles as an LRU cache:
 * <ul>
 *   <li>Accessor methods ({@link #apkPath}, {@link #binaryPath},
 *       {@link #srcDir}) materialize bytes from S3 on cache miss, then
 *       return a regular {@link Path} — the 20+ services that walk source
 *       trees are unchanged.</li>
 *   <li>Writers (upload, decompile, media) write locally first, then call
 *       the corresponding {@code afterX} hook which pushes to S3.</li>
 *   <li>{@link #touch} bumps the project's {@code .last-accessed} marker so
 *       {@link CacheEvictor} can evict cold projects when disk gets tight.</li>
 * </ul>
 *
 * <p>S3 keys are laid out the same way the filesystem is, so a cache entry
 * is a literal mirror of the relevant S3 prefix. The decompile tree is the
 * only exception — it's stored as a single tar.gz object
 * ({@code src.tar.gz}) instead of N individual objects, because (a) typical
 * decompiled APKs have 5-20k tiny files and individual PutObjects would be
 * brutal on cost + throughput, and (b) the tar.gz is what the jadx-worker
 * already streams back, so packaging is free.
 */
@Component
@ConditionalOnProperty(name = "openapk.storage.backend", havingValue = "s3")
public class S3ProjectStorage implements ProjectStorage {

    private static final Logger log = LoggerFactory.getLogger(S3ProjectStorage.class);

    /** Sentinel file inside each cached project — mtime drives LRU eviction. */
    static final String LAST_ACCESSED_MARKER = ".last-accessed";
    /** Sentinel file inside the cached src dir — present iff full extract succeeded. */
    private static final String SRC_READY_MARKER = ".src-ready";

    private final S3Client s3;
    private final S3Presigner presigner;
    private final String bucket;
    private final String prefix;
    private final Path cacheRoot;

    /**
     * Per-project mutex for srcDir materialization. Without this, the first
     * project-view load fires N parallel requests (network, db, entry points,
     * symbols, ...) and they all race into S3, all try to extract to the same
     * cache dir, and step on each other. One lock per project lets the first
     * arrival do the download + extract while the others wait for the marker.
     * Bounded by active project count -- the map entry stays around forever
     * but that's a single Object per project, negligible.
     */
    private final java.util.concurrent.ConcurrentHashMap<java.util.UUID, Object> srcLocks =
            new java.util.concurrent.ConcurrentHashMap<>();

    public S3ProjectStorage(OpenApkProperties props, S3Client s3, S3Presigner presigner) {
        this.s3 = s3;
        this.presigner = presigner;
        var s3Props = props.storage().s3();
        this.bucket = s3Props.bucket();
        this.prefix = normalizePrefix(s3Props.prefix());
        this.cacheRoot = Path.of(props.workspace().dir()).toAbsolutePath().normalize();
        try {
            Files.createDirectories(this.cacheRoot);
        } catch (IOException e) {
            throw new IllegalStateException("Cannot create cache dir " + this.cacheRoot, e);
        }
        log.info("S3 storage ready: bucket={} prefix={} cache={}", bucket, prefix, cacheRoot);
    }

    // ---- key + path helpers --------------------------------------------------

    private String s3Key(UUID userId, UUID projectId, String suffix) {
        return prefix + "users/" + userId + "/projects/" + projectId + "/" + suffix;
    }

    private String projectPrefix(UUID userId, UUID projectId) {
        return prefix + "users/" + userId + "/projects/" + projectId + "/";
    }

    @Override
    public Path projectDir(UUID userId, UUID projectId) {
        return cacheRoot.resolve("users").resolve(userId.toString())
                .resolve("projects").resolve(projectId.toString());
    }

    @Override
    public Path apkPath(UUID userId, UUID projectId) {
        Path p = projectDir(userId, projectId).resolve("apk").resolve("original.apk");
        materializeIfNeeded(p, s3Key(userId, projectId, "apk/original.apk"));
        touch(userId, projectId);
        return p;
    }

    @Override
    public Path binaryPath(UUID userId, UUID projectId) {
        Path p = projectDir(userId, projectId).resolve("bin").resolve("original.bin");
        materializeIfNeeded(p, s3Key(userId, projectId, "bin/original.bin"));
        touch(userId, projectId);
        return p;
    }

    @Override
    public Path srcDir(UUID userId, UUID projectId) {
        Path dir = projectDir(userId, projectId).resolve("src");
        Path marker = dir.resolve(SRC_READY_MARKER);
        if (!Files.exists(marker)) {
            // Serialize concurrent first-access requests for the same project.
            // The frontend opens project view and fires N parallel requests at
            // once; without the lock they all race into S3 and clobber the
            // partially-extracted tree.
            synchronized (srcLocks.computeIfAbsent(projectId, k -> new Object())) {
                if (!Files.exists(marker)) {
                    materializeSrcDir(userId, projectId, dir, marker);
                }
            }
        }
        touch(userId, projectId);
        return dir;
    }

    private void materializeSrcDir(UUID userId, UUID projectId, Path dir, Path marker) {
        // First access since boot, or evicted -- pull src.tar.gz from S3 and
        // explode it into the cache. If the tarball doesn't exist either
        // (project freshly uploaded but not yet decompiled), we return the
        // empty dir; the decompile flow will populate it before the next access.
        String key = s3Key(userId, projectId, "src.tar.gz");
        try {
            if (!objectExists(key)) {
                Files.createDirectories(dir);
                return;
            }
            Files.createDirectories(dir);
            // AWS SDK's ResponseTransformer.toFile refuses to overwrite an
            // existing destination, so we create the temp file then delete it
            // before handing the path to the SDK.
            Path tar = Files.createTempFile("openapk-src-", ".tar.gz");
            Files.deleteIfExists(tar);
            try {
                s3.getObject(GetObjectRequest.builder().bucket(bucket).key(key).build(),
                        ResponseTransformer.toFile(tar.toFile()));
                extractTarGz(tar, dir);
                Files.createFile(marker);
                log.info("restored src from S3: project={} key={}", projectId, key);
            } finally {
                Files.deleteIfExists(tar);
            }
        } catch (IOException e) {
            throw new RuntimeException("failed to materialize srcDir from S3 for " + projectId, e);
        }
    }

    @Override
    public Path mediaDir(UUID userId, UUID projectId) {
        // Media is per-file rather than a bulk tree — we don't pre-materialize
        // the whole dir. Individual file reads go through openMedia(...) and
        // the GET endpoint short-circuits to a presigned URL anyway, so the
        // cache only fills with files the user actively writes locally.
        Path dir = projectDir(userId, projectId).resolve("media");
        try {
            Files.createDirectories(dir);
        } catch (IOException e) {
            throw new RuntimeException("failed to create media dir " + dir, e);
        }
        touch(userId, projectId);
        return dir;
    }

    @Override
    public void deleteProject(UUID userId, UUID projectId) {
        // Delete S3 objects first — if we crash between this and the local
        // delete, the cache is just stale data that LRU eviction will clean.
        // If we did it the other way around, an S3 cleanup failure would
        // strand bytes the operator pays for forever.
        deleteS3Prefix(projectPrefix(userId, projectId));
        deleteLocal(projectDir(userId, projectId));
    }

    // ---- lifecycle hooks -----------------------------------------------------

    @Override
    public void touch(UUID userId, UUID projectId) {
        Path marker = projectDir(userId, projectId).resolve(LAST_ACCESSED_MARKER);
        try {
            Files.createDirectories(marker.getParent());
            if (Files.exists(marker)) {
                Files.setLastModifiedTime(marker, java.nio.file.attribute.FileTime.from(Instant.now()));
            } else {
                Files.createFile(marker);
            }
        } catch (IOException e) {
            // Touch is best-effort — never throw. Worst case: this project
            // looks "older" than it is and gets evicted sooner.
            log.debug("touch failed for {}: {}", projectId, e.toString());
        }
    }

    @Override
    public void afterUpload(UUID userId, UUID projectId) throws IOException {
        // Push whichever of apk/bin the upload wrote. Cheaper to probe two
        // paths than to thread the project kind through.
        Path apk = projectDir(userId, projectId).resolve("apk").resolve("original.apk");
        Path bin = projectDir(userId, projectId).resolve("bin").resolve("original.bin");
        if (Files.exists(apk)) {
            putFile(apk, s3Key(userId, projectId, "apk/original.apk"));
        } else if (Files.exists(bin)) {
            putFile(bin, s3Key(userId, projectId, "bin/original.bin"));
        } else {
            throw new IOException("afterUpload called but neither APK nor binary exists locally for " + projectId);
        }
    }

    @Override
    public void afterDecompile(UUID userId, UUID projectId) throws IOException {
        Path dir = projectDir(userId, projectId).resolve("src");
        if (!Files.isDirectory(dir)) {
            throw new IOException("afterDecompile called but srcDir doesn't exist: " + dir);
        }
        Path tar = Files.createTempFile("openapk-decompile-", ".tar.gz");
        try {
            tarGz(dir, tar);
            putFile(tar, s3Key(userId, projectId, "src.tar.gz"));
            // Mark the cache as already-extracted so subsequent reads don't
            // round-trip back to S3.
            Path marker = dir.resolve(SRC_READY_MARKER);
            if (!Files.exists(marker)) {
                Files.createFile(marker);
            }
        } finally {
            Files.deleteIfExists(tar);
        }
    }

    @Override
    public void pushSrcTarball(UUID userId, UUID projectId, Path tarGz) throws IOException {
        if (!Files.isRegularFile(tarGz)) {
            throw new IOException("pushSrcTarball called but tarball doesn't exist: " + tarGz);
        }
        putFile(tarGz, s3Key(userId, projectId, "src.tar.gz"));
        // Same cache-extracted marker afterDecompile writes — the caller has
        // already exploded this tarball into srcDir, so reads must not
        // round-trip back to S3.
        Path dir = projectDir(userId, projectId).resolve("src");
        if (Files.isDirectory(dir)) {
            Path marker = dir.resolve(SRC_READY_MARKER);
            if (!Files.exists(marker)) {
                Files.createFile(marker);
            }
        }
    }

    @Override
    public void afterMediaWrite(UUID userId, UUID projectId, String filename) throws IOException {
        Path file = projectDir(userId, projectId).resolve("media").resolve(filename);
        putFile(file, s3Key(userId, projectId, "media/" + filename));
    }

    @Override
    public URI presignMedia(UUID userId, UUID projectId, String filename, Duration ttl) {
        String key = s3Key(userId, projectId, "media/" + filename);
        var presigned = presigner.presignGetObject(GetObjectPresignRequest.builder()
                .signatureDuration(ttl)
                .getObjectRequest(GetObjectRequest.builder().bucket(bucket).key(key).build())
                .build());
        return presigned.url() != null ? URI.create(presigned.url().toString()) : null;
    }

    @Override
    public SrcBundle presignSrcBundle(UUID userId, UUID projectId, Duration ttl) {
        String key = s3Key(userId, projectId, "src.tar.gz");
        software.amazon.awssdk.services.s3.model.HeadObjectResponse head;
        try {
            head = s3.headObject(HeadObjectRequest.builder().bucket(bucket).key(key).build());
        } catch (NoSuchKeyException e) {
            // Pre-S3-cutover project, or ingest hasn't pushed the tarball yet.
            return null;
        }
        var presigned = presigner.presignGetObject(GetObjectPresignRequest.builder()
                .signatureDuration(ttl)
                .getObjectRequest(GetObjectRequest.builder().bucket(bucket).key(key).build())
                .build());
        if (presigned.url() == null) return null;
        return new SrcBundle(URI.create(presigned.url().toString()), head.contentLength(), head.eTag());
    }

    @Override
    public InputStream openMedia(UUID userId, UUID projectId, String filename) throws IOException {
        // Stream straight from S3 so we don't fill the cache with media files
        // (typically large; we'd rather presign for normal reads and only
        // fall through here for endpoints that need bytes server-side).
        String key = s3Key(userId, projectId, "media/" + filename);
        return s3.getObject(GetObjectRequest.builder().bucket(bucket).key(key).build());
    }

    @Override
    public List<MediaEntry> listMedia(UUID userId, UUID projectId) {
        // S3 is the source of truth — the local cache may not have every
        // file post-task-recycle. Walk the bucket prefix instead.
        String mediaPrefix = projectPrefix(userId, projectId) + "media/";
        var req = ListObjectsV2Request.builder().bucket(bucket).prefix(mediaPrefix).build();
        var resp = s3.listObjectsV2Paginator(req);
        return resp.stream()
                .flatMap(p -> p.contents() == null ? Stream.<S3Object>empty() : p.contents().stream())
                .filter(o -> o.key().endsWith(".png"))
                .map(o -> {
                    String filename = o.key().substring(mediaPrefix.length());
                    return new MediaEntry(filename, o.size(), o.lastModified());
                })
                .sorted(Comparator.comparing(MediaEntry::createdAt).reversed())
                .toList();
    }

    @Override
    public void deleteMedia(UUID userId, UUID projectId, String filename) throws IOException {
        String key = s3Key(userId, projectId, "media/" + filename);
        s3.deleteObject(DeleteObjectRequest.builder().bucket(bucket).key(key).build());
        // Best-effort local cleanup. S3 delete already succeeded.
        Files.deleteIfExists(projectDir(userId, projectId).resolve("media").resolve(filename));
    }

    // ---- S3 plumbing ---------------------------------------------------------

    private void putFile(Path file, String key) throws IOException {
        long size = Files.size(file);
        s3.putObject(PutObjectRequest.builder().bucket(bucket).key(key).build(),
                RequestBody.fromFile(file));
        log.info("S3 put: bucket={} key={} bytes={}", bucket, key, size);
    }

    private boolean objectExists(String key) {
        try {
            s3.headObject(HeadObjectRequest.builder().bucket(bucket).key(key).build());
            return true;
        } catch (NoSuchKeyException e) {
            return false;
        }
    }

    private void materializeIfNeeded(Path local, String key) {
        if (Files.exists(local)) return;
        try {
            Files.createDirectories(local.getParent());
            // Download to a sibling tempfile first, then atomic move into place.
            // ResponseTransformer.toFile() refuses to overwrite, and downloading
            // directly to `local` leaves a half-written file there if the
            // process dies mid-transfer -- the next caller's `Files.exists`
            // would short-circuit on a corrupt file.
            Path tmp = local.resolveSibling(local.getFileName() + ".part-" + System.nanoTime());
            try {
                s3.getObject(GetObjectRequest.builder().bucket(bucket).key(key).build(),
                        ResponseTransformer.toFile(tmp.toFile()));
                Files.move(tmp, local, java.nio.file.StandardCopyOption.ATOMIC_MOVE,
                        java.nio.file.StandardCopyOption.REPLACE_EXISTING);
                log.info("S3 fetched: key={} -> {}", key, local);
            } finally {
                Files.deleteIfExists(tmp);
            }
        } catch (NoSuchKeyException e) {
            // OK -- caller is reading a path that hasn't been written yet.
        } catch (IOException e) {
            throw new RuntimeException("failed to fetch " + key + " from S3", e);
        }
    }

    private void deleteS3Prefix(String prefix) {
        var listReq = ListObjectsV2Request.builder().bucket(bucket).prefix(prefix).build();
        var resp = s3.listObjectsV2Paginator(listReq);
        for (var page : resp) {
            List<S3Object> contents = page.contents();
            if (contents == null || contents.isEmpty()) continue;
            var ids = contents.stream()
                    .map(o -> ObjectIdentifier.builder().key(o.key()).build())
                    .toList();
            s3.deleteObjects(DeleteObjectsRequest.builder()
                    .bucket(bucket)
                    .delete(Delete.builder().objects(ids).build())
                    .build());
            log.info("S3 deleted {} objects under prefix={}", ids.size(), prefix);
        }
    }

    private void deleteLocal(Path dir) {
        if (!Files.exists(dir)) return;
        try (Stream<Path> walk = Files.walk(dir)) {
            walk.sorted(Comparator.reverseOrder()).forEach(p -> {
                try {
                    Files.deleteIfExists(p);
                } catch (IOException e) {
                    log.warn("local cache delete failed for {}: {}", p, e.toString());
                }
            });
        } catch (IOException e) {
            log.warn("local cache walk failed for {}: {}", dir, e.toString());
        }
    }

    // ---- tar.gz pack/unpack -- shells out, same as JadxDecompileService -----

    private static void tarGz(Path dir, Path out) throws IOException {
        ProcessBuilder pb = new ProcessBuilder("tar", "-czf", out.toString(), "-C", dir.toString(), ".")
                .redirectErrorStream(true);
        Process proc = pb.start();
        try {
            byte[] stderr = proc.getInputStream().readAllBytes();
            int rc = proc.waitFor();
            if (rc != 0) {
                throw new IOException("tar pack failed rc=" + rc + ": " + new String(stderr));
            }
        } catch (InterruptedException e) {
            proc.destroyForcibly();
            Thread.currentThread().interrupt();
            throw new IOException("tar pack interrupted", e);
        }
    }

    private static void extractTarGz(Path tar, Path outDir) throws IOException {
        ProcessBuilder pb = new ProcessBuilder("tar", "-xzf", tar.toString(), "-C", outDir.toString())
                .redirectErrorStream(true);
        Process proc = pb.start();
        try {
            byte[] stderr = proc.getInputStream().readAllBytes();
            int rc = proc.waitFor();
            if (rc != 0) {
                throw new IOException("tar extract failed rc=" + rc + ": " + new String(stderr));
            }
        } catch (InterruptedException e) {
            proc.destroyForcibly();
            Thread.currentThread().interrupt();
            throw new IOException("tar extract interrupted", e);
        }
    }

    private static String normalizePrefix(String raw) {
        if (raw == null || raw.isBlank()) return "";
        String p = raw.trim();
        if (p.startsWith("/")) p = p.substring(1);
        if (!p.endsWith("/")) p = p + "/";
        return p;
    }

    Path cacheRoot() { return cacheRoot; }
}
