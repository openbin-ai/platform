package ai.openapk.core.scripts.dto;

import ai.openapk.core.scripts.ProjectScript;

import java.time.Instant;
import java.util.UUID;

public record ScriptResponse(
        UUID id,
        String name,
        String language,
        String description,
        String content,
        String sourceRef,
        UUID createdBy,
        String createdByName,
        Instant createdAt
) {
    public static ScriptResponse from(ProjectScript s) {
        var by = s.getCreatedBy();
        String name = null;
        if (by != null) {
            name = by.getDisplayName() != null && !by.getDisplayName().isBlank() ? by.getDisplayName() : by.getEmail();
        }
        return new ScriptResponse(s.getId(), s.getName(), s.getLanguage(), s.getDescription(), s.getContent(),
                s.getSourceRef(), by == null ? null : by.getId(), name, s.getCreatedAt());
    }
}
