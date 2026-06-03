package ai.openapk.core.analysis.dto;

public record Hotspot(
        String path,
        String severity,
        String reason
) {}
