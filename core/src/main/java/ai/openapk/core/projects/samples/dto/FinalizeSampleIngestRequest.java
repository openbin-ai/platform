package ai.openapk.core.projects.samples.dto;

import jakarta.validation.constraints.NotBlank;

/** Step 2: the CLI's S3 PUT completed; flip the sample to READY. */
public record FinalizeSampleIngestRequest(
        @NotBlank String sampleId
) {}
