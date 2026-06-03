package ai.openapk.core.analysis.dto;

public record SignatureHit(
        String file,
        int line,
        String snippet
) {}
