package ai.openapk.core.projects.samples.dto;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Positive;
import jakarta.validation.constraints.Size;

/**
 * Step 1 of adding a sample to an existing BIN project (multi-sample). Same
 * two-step S3 shape as the top-level ingest: small metadata here, the heavy
 * gzipped worker JSON goes straight to S3 via the presigned PUT.
 */
public record InitiateSampleIngestRequest(
        @NotBlank String schemaVersion,
        @NotBlank @Size(max = 200) String label,
        @Size(max = 512) String originalFilename,
        String archHint,
        @NotBlank @Pattern(regexp = "^[0-9a-fA-F]{64}$", message = "sha256 must be 64 hex chars") String sha256,
        @Positive long sizeBytes,
        @Positive long uploadSizeBytes
) {}
