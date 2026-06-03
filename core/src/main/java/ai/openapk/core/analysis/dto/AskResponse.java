package ai.openapk.core.analysis.dto;

public record AskResponse(
        String answer,
        String model,
        int inputTokens,
        int outputTokens
) {}
