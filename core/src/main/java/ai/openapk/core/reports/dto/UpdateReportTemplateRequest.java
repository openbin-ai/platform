package ai.openapk.core.reports.dto;

import ai.openapk.core.reports.TemplateMode;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;

import java.util.List;

public record UpdateReportTemplateRequest(
        @NotBlank @Size(max = 120) String name,
        @Size(max = 1000) String description,
        @NotNull TemplateMode mode,
        @NotNull @Valid List<ReportSection> sections
) {}
