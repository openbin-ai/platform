package ai.openapk.core.nativeanalysis.dto;

import jakarta.validation.constraints.NotBlank;

/**
 * CLI → backend: "the PUT to S3 completed; please HEAD the object and flip
 * the row to READY." The {@code nativeAnalysisId} is the UUID returned from
 * {@code /initiate} — used to find the {@code INGEST_PENDING} row to
 * finalize. Ownership is re-checked against the current user.
 */
public record FinalizeNativeIngestRequest(
        @NotBlank String nativeAnalysisId
) {}
