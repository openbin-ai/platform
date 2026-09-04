package ai.openapk.core.projects.samples.dto;

import jakarta.validation.constraints.NotBlank;

/**
 * Web flow: absorb an EXISTING standalone BIN project into this one as a
 * sample. The source project is deleted afterwards (its report/renames/
 * highlights go with it — the frontend warns explicitly).
 */
public record MoveSampleFromProjectRequest(
        @NotBlank String sourceProjectId
) {}
