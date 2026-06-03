package ai.openapk.core.reports.dto;

import ai.openapk.core.reports.TemplateMode;

import java.time.Instant;
import java.util.List;
import java.util.UUID;

public record ReportTemplateResponse(
        UUID id,
        String name,
        String description,
        TemplateMode mode,
        List<ReportSection> sections,
        Instant createdAt,
        Instant updatedAt
) {}
