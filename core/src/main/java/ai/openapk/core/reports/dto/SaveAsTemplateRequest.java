package ai.openapk.core.reports.dto;

import ai.openapk.core.reports.TemplateMode;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;

public record SaveAsTemplateRequest(
        @NotBlank @Size(max = 120) String name,
        @Size(max = 1000) String description,
        @NotNull TemplateMode mode,
        /** If true, clear each section's content so the template is reusable empty. */
        boolean blankContent
) {}
