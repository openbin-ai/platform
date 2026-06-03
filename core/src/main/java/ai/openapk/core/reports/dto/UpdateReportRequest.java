package ai.openapk.core.reports.dto;

import jakarta.validation.Valid;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;

import java.util.List;

public record UpdateReportRequest(
        @NotBlank @Size(max = 200) String title,
        @NotNull @Valid List<ReportSection> sections
) {}
