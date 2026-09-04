package ai.openapk.core.projects.samples.dto;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;

/** Rename a sample's display label (the sample-switcher tab text). */
public record UpdateSampleRequest(
        @NotBlank @Size(max = 200) String label
) {}
