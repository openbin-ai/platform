package ai.openapk.core.projects.storage;

import java.io.IOException;
import java.io.InputStream;
import java.net.URI;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.attribute.BasicFileAttributes;
import java.time.Duration;
import java.time.Instant;
import java.util.Comparator;
import java.util.List;
import java.util.UUID;
import java.util.stream.Stream;

/**
 * Abstracts where a project's bytes live. Two impls today:
 *
 * <ul>
 *   <li>{@link FilesystemProjectStorage} — workspace dir is the source of
 *       truth. Dev default; survives a single host but not container recycle.</li>
 *   <li>S3-backed (see {@code S3ProjectStorage}) — S3 is the source of truth;
 *       workspace dir is a per-task LRU cache. Activated by
 *       {@code openapk.storage.backend=s3}.</li>
 * </ul>
 *
 * <p>The directory-returning methods stay because ~20 services walk source
 * trees as plain {@link Path}s. The S3 impl materializes content into the
 * cache on demand so callers don't need to know the backend.
 *
 * <p>{@link #touch} is the LRU signal — call it whenever a project is
 * accessed so the evictor knows what's hot. {@link #afterUpload} and
 * {@link #afterDecompile} are the durability hooks the upload/decompile
 * flows call so the S3 impl can persist freshly-written bytes.
 */
public interface ProjectStorage {

    /** Root directory for a project. Implementations must create it on demand. */
    Path projectDir(UUID userId, UUID projectId);

    /** Where the originally uploaded APK lives. APK projects only. */
    Path apkPath(UUID userId, UUID projectId);

    /**
     * Where the originally uploaded native binary lives. BIN projects only.
     * Kept under a separate {@code bin/} subdir (not {@code apk/}) so the
     * storage layout mirrors the project kind and a future cleanup tool can
     * tell at a glance what's inside without consulting the DB.
     */
    Path binaryPath(UUID userId, UUID projectId);

    /** Where JADX writes decompiled output (sources + resources). */
    Path srcDir(UUID userId, UUID projectId);

    /** Where report screenshots / attached media live. */
    Path mediaDir(UUID userId, UUID projectId);

    /** Recursively delete a project's storage. Idempotent. */
    void deleteProject(UUID userId, UUID projectId);

    /**
     * Record that a project was just accessed. The fs impl is a no-op; the
     * S3 impl bumps an mtime sentinel that the LRU evictor reads. Cheap —
     * called from hot paths (file reads, symbol lookups) and must not throw.
     */
    default void touch(UUID userId, UUID projectId) { /* no-op for fs */ }

    /**
     * Called after an upload write into {@link #apkPath} / {@link #binaryPath}
     * has committed locally. The S3 impl persists the file to durable storage;
     * the fs impl is a no-op. Synchronous on purpose — callers expect upload
     * durability before returning to the user.
     */
    default void afterUpload(UUID userId, UUID projectId) throws IOException { /* no-op for fs */ }

    /**
     * Called after a decompile run has populated {@link #srcDir} (and any
     * future post-processing). The S3 impl tarballs the dir and uploads as a
     * single object; the fs impl is a no-op. Synchronous so a task recycle
     * mid-call can't drop bytes.
     */
    default void afterDecompile(UUID userId, UUID projectId) throws IOException { /* no-op for fs */ }

    /**
     * Called when a single media file has been written to {@link #mediaDir}.
     * The S3 impl uploads that one file. The fs impl is a no-op.
     */
    default void afterMediaWrite(UUID userId, UUID projectId, String filename) throws IOException { /* no-op for fs */ }

    /**
     * Return a presigned URL for a single media file, or {@code null} if the
     * backend doesn't presign (fs impl returns {@code null} — caller falls
     * back to streaming through the app). TTL is set in
     * {@code openapk.storage.presigned-url-ttl}.
     */
    default URI presignMedia(UUID userId, UUID projectId, String filename, Duration ttl) { return null; }

    /**
     * Stream the contents of {@link #mediaDir}'s single file. Defaults to
     * reading from the local cache path — fine for fs and for S3 once the
     * file has been materialized. Used as the fallback path when
     * {@link #presignMedia} returns {@code null}.
     */
    default InputStream openMedia(UUID userId, UUID projectId, String filename) throws IOException {
        return Files.newInputStream(mediaDir(userId, projectId).resolve(filename));
    }

    /** Lightweight media-file listing entry — name + size + creation time. */
    record MediaEntry(String filename, long sizeBytes, Instant createdAt) {}

    /**
     * List the media files for a project. Default walks the local directory,
     * which matches the fs-backend semantics today. S3 impl overrides this
     * to list from the bucket — the local cache may not have every file
     * post-task-recycle.
     */
    default List<MediaEntry> listMedia(UUID userId, UUID projectId) throws IOException {
        Path dir = mediaDir(userId, projectId);
        if (!Files.exists(dir)) return List.of();
        try (Stream<Path> walk = Files.list(dir)) {
            return walk
                    .filter(p -> p.getFileName().toString().endsWith(".png"))
                    .map(p -> {
                        try {
                            BasicFileAttributes a = Files.readAttributes(p, BasicFileAttributes.class);
                            return new MediaEntry(
                                    p.getFileName().toString(),
                                    a.size(),
                                    a.creationTime().toInstant());
                        } catch (IOException e) {
                            return null;
                        }
                    })
                    .filter(java.util.Objects::nonNull)
                    .sorted(Comparator.comparing(MediaEntry::createdAt).reversed())
                    .toList();
        }
    }

    /**
     * Delete one media file. Default removes the local file only (correct
     * for fs); S3 impl overrides to delete the S3 object too. Idempotent —
     * missing file is not an error.
     */
    default void deleteMedia(UUID userId, UUID projectId, String filename) throws IOException {
        Files.deleteIfExists(mediaDir(userId, projectId).resolve(filename));
    }
}
