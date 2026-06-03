package ai.openapk.core.analysis.dto;

import ai.openapk.core.analysis.AnalysisMode;
import jakarta.validation.constraints.NotNull;

import java.util.UUID;

public record AnalysisRequest(
        @NotNull AnalysisMode mode,
        @NotNull UUID credentialId,
        String model
) {}
