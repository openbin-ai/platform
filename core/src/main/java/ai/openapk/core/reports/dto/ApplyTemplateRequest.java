package ai.openapk.core.reports.dto;

import jakarta.validation.constraints.NotNull;

import java.util.UUID;

public record ApplyTemplateRequest(
        @NotNull UUID templateId,
        /** If true, replace the title with the template name. Default false. */
        boolean replaceTitle
) {}
