package ai.openapk.core.analysis.dto;

import ai.openapk.core.analysis.AnalysisMode;

import java.util.List;

public record AnalysisResponse(
        AnalysisMode mode,
        String summary,
        List<Hotspot> hotspots,
        List<Ioc> iocs,
        List<String> nextSteps,
        String rawModelOutput,
        String model,
        int inputTokens,
        int outputTokens
) {}
