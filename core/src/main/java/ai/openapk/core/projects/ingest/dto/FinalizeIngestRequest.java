package ai.openapk.core.projects.ingest.dto;

import jakarta.validation.constraints.NotBlank;

/**
 * Step 2 of the S3 ingest flow. The CLI calls this after PUT to S3
 * succeeds; the backend HEADs the object, streams the metadata out,
 * and flips the project status from INGEST_PENDING to READY.
 *
 * <p>{@code projectId} is the row created in step 1. The backend
 * re-verifies ownership in the finalize handler — a malicious caller
 * can't finalize someone else's pending project.
 */
public record FinalizeIngestRequest(
        @NotBlank String projectId
) {}
