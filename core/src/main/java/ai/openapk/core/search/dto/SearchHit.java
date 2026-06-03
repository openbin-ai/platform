package ai.openapk.core.search.dto;

public record SearchHit(
        String file,
        int line,
        String snippet
) {}
