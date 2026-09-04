package ai.openapk.core.projects.analysis;

import ai.openapk.core.config.OpenApkProperties;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;
import software.amazon.awssdk.services.s3.S3Client;
import software.amazon.awssdk.services.s3.model.DeleteObjectRequest;
import software.amazon.awssdk.services.s3.model.GetObjectRequest;
import software.amazon.awssdk.services.s3.model.HeadObjectRequest;
import software.amazon.awssdk.services.s3.model.HeadObjectResponse;
import software.amazon.awssdk.services.s3.model.PutObjectRequest;
import software.amazon.awssdk.services.s3.model.PutObjectTaggingRequest;
import software.amazon.awssdk.services.s3.model.Tag;
import software.amazon.awssdk.services.s3.model.Tagging;
import software.amazon.awssdk.services.s3.presigner.S3Presigner;
import software.amazon.awssdk.services.s3.presigner.model.PresignedPutObjectRequest;
import software.amazon.awssdk.services.s3.presigner.model.PutObjectPresignRequest;

import java.io.InputStream;
import java.time.Duration;
import java.util.UUID;

/**
 * High-level façade over the analysis bucket. Exposes three operations
 * the ingest controller cares about:
 *
 * <ol>
 *   <li>{@link #buildUploadKey(UUID, UUID)} — deterministic key naming
 *       per (user, project). UUIDs make keys non-enumerable.</li>
 *   <li>{@link #presignUpload(String, long, String)} — short-TTL PUT URL
 *       binding the upload to a specific content length so a leaked URL
 *       can't be repurposed for arbitrary content.</li>
 *   <li>{@link #headAndStream(String)} — confirms the object exists +
 *       returns a streaming handle so {@link AnalysisMetadataExtractor}
 *       can parse metadata without buffering the whole gzipped JSON.</li>
 *   <li>{@link #signDownloadUrl(String)} — CloudFront-signed GET URL the
 *       frontend uses to fetch the body.</li>
 * </ol>
 *
 * <p>All bucket / region / TTL config lives in
 * {@link OpenApkProperties.AnalysisStorage}; this service only reads it.
 */
@Service
public class AnalysisStorageService {

    private static final Logger log = LoggerFactory.getLogger(AnalysisStorageService.class);

    /** Object MIME type. We require gzip on uploads so the body parses cheaply. */
    public static final String OBJECT_CONTENT_TYPE = "application/json";
    public static final String OBJECT_CONTENT_ENCODING = "gzip";

    private final S3Client s3;
    private final S3Presigner presigner;
    private final CloudFrontUrlSigner cfSigner;
    private final OpenApkProperties.AnalysisStorage cfg;

    public AnalysisStorageService(
            @org.springframework.beans.factory.annotation.Qualifier("analysisS3Client")
            S3Client analysisS3Client,
            @org.springframework.beans.factory.annotation.Qualifier("analysisS3Presigner")
            S3Presigner analysisS3Presigner,
            CloudFrontUrlSigner cfSigner,
            OpenApkProperties props
    ) {
        this.s3 = analysisS3Client;
        this.presigner = analysisS3Presigner;
        this.cfSigner = cfSigner;
        this.cfg = props.analysisStorage();
    }

    /**
     * Format: {@code analysis/{userUuid}/{projectUuid}/result.json.gz}.
     * Both UUIDs are required because (a) the user-uuid layer makes
     * cross-user key fishing impossible, and (b) the per-project leaf
     * lets the lifecycle rule target individual orphans.
     */
    public String buildUploadKey(UUID userId, UUID projectId) {
        String prefix = cfg.prefix() == null || cfg.prefix().isBlank() ? "analysis" : cfg.prefix();
        return prefix + "/" + userId + "/" + projectId + "/result.json.gz";
    }

    /**
     * Mints a presigned PUT URL bound to the object's content length and
     * type. {@code expectedSizeBytes} is encoded into the signature so
     * the URL can't be reused to upload a larger payload; if the CLI
     * doesn't know the size yet, pass 0 and the signature uses a
     * generic content-length-range with the configured cap.
     */
    public PresignedPut presignUpload(String key, long expectedSizeBytes, String tagStatusPending) {
        PutObjectRequest.Builder req = PutObjectRequest.builder()
                .bucket(cfg.bucket())
                .key(key)
                .contentType(OBJECT_CONTENT_TYPE)
                .contentEncoding(OBJECT_CONTENT_ENCODING);
        if (expectedSizeBytes > 0) {
            req.contentLength(expectedSizeBytes);
        }
        // S3 object tagging — the lifecycle rule targets `status=pending`
        // for orphan cleanup, so the CLI must include this header on PUT.
        if (tagStatusPending != null) {
            req.tagging(tagStatusPending);
        }
        Duration ttl = cfg.presignedPutTtl() != null ? cfg.presignedPutTtl() : Duration.ofMinutes(15);
        PresignedPutObjectRequest signed = presigner.presignPutObject(
                PutObjectPresignRequest.builder()
                        .signatureDuration(ttl)
                        .putObjectRequest(req.build())
                        .build()
        );
        log.info("presigned PUT minted key={} ttl={}s contentLen={}", key, ttl.toSeconds(), expectedSizeBytes);
        return new PresignedPut(
                signed.url().toString(),
                ttl,
                OBJECT_CONTENT_TYPE,
                OBJECT_CONTENT_ENCODING
        );
    }

    /**
     * HEAD the object to confirm the CLI actually completed the PUT, and
     * grab the ETag + size for the project row. Throws if the object
     * doesn't exist or HEAD fails — the finalize endpoint surfaces this
     * as a 400 so the CLI knows to re-upload.
     */
    public ObjectMetadata head(String key) {
        HeadObjectResponse resp = s3.headObject(HeadObjectRequest.builder()
                .bucket(cfg.bucket())
                .key(key)
                .build());
        return new ObjectMetadata(resp.eTag(), resp.contentLength(),
                resp.contentEncoding(), resp.contentType());
    }

    /**
     * Returns a streaming handle to the gzipped body. Caller is responsible
     * for closing the stream; wrap in {@code GZIPInputStream} for the
     * JSON parser.
     */
    public InputStream openBody(String key) {
        return s3.getObject(GetObjectRequest.builder()
                .bucket(cfg.bucket())
                .key(key)
                .build());
    }

    /**
     * Flip the object's {@code status} tag from {@code pending} to {@code
     * ready} once an upload is finalized. CRITICAL: the bucket has a lifecycle
     * rule that DELETES objects tagged {@code status=pending} after 1 day (to
     * reap orphaned uploads from CLI crashes). Without this call, a perfectly
     * good finalized result keeps the pending tag the presigned PUT applied
     * and self-destructs ~24-48h later, leaving the project row READY but the
     * S3 object gone (403 on the signed CloudFront URL). Replacing the tag set
     * with {@code status=ready} takes the object out of the rule's filter.
     */
    public void markReady(String key) {
        s3.putObjectTagging(PutObjectTaggingRequest.builder()
                .bucket(cfg.bucket())
                .key(key)
                .tagging(Tagging.builder()
                        .tagSet(Tag.builder().key("status").value("ready").build())
                        .build())
                .build());
    }

    /**
     * Delete an analysis blob. Best-effort + logged so a transient S3 failure
     * never fails the surrounding DB transaction (the caller decides refcount
     * safety — this only deletes when it's the last reference). A missing
     * object is a no-op (S3 delete is idempotent).
     */
    public void deleteObject(String key) {
        try {
            s3.deleteObject(DeleteObjectRequest.builder()
                    .bucket(cfg.bucket())
                    .key(key)
                    .build());
        } catch (Exception e) {
            log.warn("failed to delete analysis blob {} (leaving orphaned): {}", key, e.toString());
        }
    }

    /**
     * Server-side copy of an analysis blob to a new key (multi-sample "move
     * an existing project in as a sample"). Copying — rather than re-pointing
     * the sample row at the source key — keeps the fork/refcount story simple:
     * project blobs may be SHARED with forks and are refcounted at delete
     * time over the projects table only, so a sample referencing a project
     * key would dangle when the last project drops it. A fresh copy under the
     * samples/ layout is owned by exactly one sample row. Tags are REPLACED
     * with {@code status=ready} so the copy can never inherit a stale
     * {@code pending} tag and get reaped by the lifecycle rule.
     */
    public void copyObject(String srcKey, String dstKey) {
        s3.copyObject(software.amazon.awssdk.services.s3.model.CopyObjectRequest.builder()
                .sourceBucket(cfg.bucket())
                .sourceKey(srcKey)
                .destinationBucket(cfg.bucket())
                .destinationKey(dstKey)
                .taggingDirective(software.amazon.awssdk.services.s3.model.TaggingDirective.REPLACE)
                .tagging(Tagging.builder()
                        .tagSet(Tag.builder().key("status").value("ready").build())
                        .build())
                .build());
    }

    /** Mints a CloudFront signed GET URL for the frontend. */
    public String signDownloadUrl(String key) {
        Duration ttl = cfg.presignedGetTtl() != null ? cfg.presignedGetTtl() : Duration.ofMinutes(5);
        return cfSigner.sign(key, ttl);
    }

    public boolean cdnConfigured() {
        return cfSigner.isConfigured();
    }

    public record PresignedPut(
            String url,
            Duration expiresIn,
            String contentType,
            String contentEncoding
    ) {}

    public record ObjectMetadata(
            String etag,
            Long sizeBytes,
            String contentEncoding,
            String contentType
    ) {}
}
