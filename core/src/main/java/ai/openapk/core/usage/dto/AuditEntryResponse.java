package ai.openapk.core.usage.dto;

import ai.openapk.core.usage.LlmAuditEntry;

import java.time.Instant;
import java.util.UUID;

public record AuditEntryResponse(
        UUID id,
        UUID projectId,
        String provider,
        String model,
        String purpose,
        int inputTokens,
        int outputTokens,
        boolean success,
        String errorMessage,
        Instant createdAt
) {
    public static AuditEntryResponse from(LlmAuditEntry e) {
        return new AuditEntryResponse(
                e.getId(),
                e.getProjectId(),
                e.getProvider(),
                e.getModel(),
                e.getPurpose(),
                e.getInputTokens(),
                e.getOutputTokens(),
                e.isSuccess(),
                e.getErrorMessage(),
                e.getCreatedAt()
        );
    }
}
