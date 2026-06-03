package ai.openapk.core.renames.dto;

import ai.openapk.core.renames.ProjectRename;
import ai.openapk.core.renames.RenameStatus;

import java.time.Instant;
import java.util.UUID;

public record RenameDto(
        UUID id,
        String original,
        String suggested,
        String scope,
        RenameStatus status,
        String confidence,
        String sourcePath,
        String rationale,
        Instant createdAt
) {
    public static RenameDto from(ProjectRename r) {
        return new RenameDto(
                r.getId(),
                r.getOriginal(),
                r.getSuggested(),
                r.getScope(),
                r.getStatus(),
                r.getConfidence(),
                r.getSourcePath(),
                r.getRationale(),
                r.getCreatedAt()
        );
    }
}
