package ai.openapk.core.reports.dto;

import jakarta.validation.constraints.NotBlank;

/** Body for POST /report/populate — names which section to overwrite with formatted analysis output. */
public record PopulateRequest(
        @NotBlank String sectionId
) {}
