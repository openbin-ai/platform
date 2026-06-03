package ai.openapk.core.nativeanalysis.dto;

import jakarta.validation.constraints.NotBlank;

public record AnalyzeRequest(@NotBlank String libPath) {}
