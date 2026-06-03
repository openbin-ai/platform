package ai.openapk.core.projects.dto;

public record FileContentResponse(
        String path,
        long size,
        boolean truncated,
        String encoding,
        String content
) {}
