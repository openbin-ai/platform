package ai.openapk.core.deobf.dto;

import ai.openapk.core.deobf.FunctionDeobfuscation;

import java.time.Instant;

public record FunctionDeobfuscationResponse(
        String originalName,
        String deobfuscated,
        String explanation,
        String model,
        int inputTokens,
        int outputTokens,
        Instant createdAt
) {
    public static FunctionDeobfuscationResponse from(FunctionDeobfuscation d) {
        return new FunctionDeobfuscationResponse(
                d.getOriginalName(),
                d.getDeobfuscated(),
                d.getExplanation(),
                d.getModel(),
                d.getInputTokens(),
                d.getOutputTokens(),
                d.getCreatedAt());
    }
}
