package ai.openapk.core.ctf;

import ai.openapk.core.config.OpenApkProperties;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.ObjectProvider;
import org.springframework.stereotype.Component;
import software.amazon.awssdk.core.sync.RequestBody;
import software.amazon.awssdk.services.s3.S3Client;
import software.amazon.awssdk.services.s3.model.DeleteObjectRequest;
import software.amazon.awssdk.services.s3.model.GetObjectRequest;
import software.amazon.awssdk.services.s3.model.PutObjectRequest;
import software.amazon.awssdk.services.s3.presigner.S3Presigner;
import software.amazon.awssdk.services.s3.presigner.model.GetObjectPresignRequest;

import java.io.IOException;
import java.net.URI;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardCopyOption;
import java.time.Duration;
import java.util.Optional;
import java.util.UUID;

/**
 * Where a challenge's raw binary lives. Keyed by challenge id, not project,
 * because the project only ever holds decompiled output and a challenge can
 * be re-pointed at another project without losing its download.
 *
 * <p>With the s3 backend the file is one object under {@code ctf/} and
 * downloads are presigned GETs with an attachment disposition. With the fs
 * backend (dev, tests) it sits under the workspace dir and the controller
 * streams it. The service never needs to know which.
 */
@Component
public class CtfBinaryStore {

    private static final Logger log = LoggerFactory.getLogger(CtfBinaryStore.class);

    private final S3Client s3;          // null on the fs backend
    private final S3Presigner presigner; // null on the fs backend
    private final String bucket;
    private final String prefix;
    private final Path root;

    public CtfBinaryStore(OpenApkProperties props, ObjectProvider<S3Client> s3, ObjectProvider<S3Presigner> presigner) {
        boolean useS3 = "s3".equalsIgnoreCase(props.storage().backend());
        this.s3 = useS3 ? s3.getIfAvailable() : null;
        this.presigner = useS3 ? presigner.getIfAvailable() : null;
        var s3Props = props.storage().s3();
        this.bucket = s3Props == null ? null : s3Props.bucket();
        String p = s3Props == null || s3Props.prefix() == null ? "" : s3Props.prefix();
        if (!p.isEmpty() && !p.endsWith("/")) p += "/";
        this.prefix = p;
        this.root = Path.of(props.workspace().dir()).toAbsolutePath().normalize().resolve("ctf");
    }

    public boolean isS3() {
        return s3 != null;
    }

    /** Move an already-written temp file into place. Returns nothing; failures throw. */
    public void store(UUID challengeId, String filename, Path tmp) throws IOException {
        if (isS3()) {
            s3.putObject(PutObjectRequest.builder()
                            .bucket(bucket).key(key(challengeId, filename))
                            .contentType("application/octet-stream")
                            .build(),
                    RequestBody.fromFile(tmp));
            log.info("CTF binary stored: s3://{}/{} ({} bytes)", bucket, key(challengeId, filename), Files.size(tmp));
            return;
        }
        Path target = localPath(challengeId, filename);
        Files.createDirectories(target.getParent());
        Files.move(tmp, target, StandardCopyOption.REPLACE_EXISTING);
        log.info("CTF binary stored: {} ({} bytes)", target, Files.size(target));
    }

    public void delete(UUID challengeId, String filename) {
        if (filename == null) return;
        try {
            if (isS3()) {
                s3.deleteObject(DeleteObjectRequest.builder().bucket(bucket).key(key(challengeId, filename)).build());
            } else {
                Files.deleteIfExists(localPath(challengeId, filename));
            }
        } catch (Exception e) {
            // A leftover object is a cost, not a correctness problem.
            log.warn("CTF binary delete failed for {}/{}: {}", challengeId, filename, e.toString());
        }
    }

    /** Presigned download URL on s3; empty on the fs backend (stream {@link #localPath} instead). */
    public Optional<URI> presign(UUID challengeId, String filename, Duration ttl) {
        if (!isS3() || presigner == null) return Optional.empty();
        var presigned = presigner.presignGetObject(GetObjectPresignRequest.builder()
                .signatureDuration(ttl)
                .getObjectRequest(GetObjectRequest.builder()
                        .bucket(bucket).key(key(challengeId, filename))
                        .responseContentDisposition("attachment; filename=\"" + filename + "\"")
                        .responseContentType("application/octet-stream")
                        .build())
                .build());
        return Optional.ofNullable(presigned.url()).map(u -> URI.create(u.toString()));
    }

    public Path localPath(UUID challengeId, String filename) {
        return root.resolve(challengeId.toString()).resolve(filename);
    }

    private String key(UUID challengeId, String filename) {
        return prefix + "ctf/" + challengeId + "/" + filename;
    }

    /**
     * A filename safe for an S3 key, a Content-Disposition header and a
     * directory on disk: path separators dropped, anything outside
     * {@code [A-Za-z0-9._-]} replaced, length capped. Never empty.
     */
    public static String safeFilename(String original) {
        String base = original == null ? "" : original;
        int slash = Math.max(base.lastIndexOf('/'), base.lastIndexOf('\\'));
        if (slash >= 0) base = base.substring(slash + 1);
        base = base.replaceAll("[^A-Za-z0-9._-]", "_").replaceAll("^\\.+", "");
        if (base.length() > 120) base = base.substring(base.length() - 120);
        return base.isEmpty() ? "challenge.bin" : base;
    }
}
