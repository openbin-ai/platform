package ai.openapk.core.analysis.dto;

public record Ioc(
        String type,
        String value,
        int occurrences
) {}
