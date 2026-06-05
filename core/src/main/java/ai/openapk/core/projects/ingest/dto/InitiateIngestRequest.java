package ai.openapk.core.projects.ingest.dto;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Positive;

/**
 * Step 1 of the S3 ingest flow. The CLI sends only the small per-binary
 * metadata fields it already knows; the heavy {@code workerOutput} body
 * uploads directly to S3 via the presigned PUT URL returned in
 * {@link InitiateIngestResponse}.
 *
 * <p>{@code uploadSizeBytes} is the size of the gzipped JSON the CLI is
 * about to PUT. We bind it into the presigned URL's signature so a
 * leaked URL can't be reused to upload arbitrarily large content. CLI
 * computes this after gzipping its result.json.
 */
public record InitiateIngestRequest(
        @NotBlank String name,
        @NotBlank String originalFilename,
        String archHint,
        @Positive long sizeBytes,
        @NotBlank String sha256,
        @NotBlank String schemaVersion,
        String source,
        @Positive long uploadSizeBytes
) {}
