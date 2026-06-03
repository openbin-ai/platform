package ai.openapk.core.credentials.dto;

import ai.openapk.core.credentials.LlmCredential;
import ai.openapk.core.credentials.LlmProvider;

import java.time.Instant;
import java.util.UUID;

public record CredentialResponse(
        UUID id,
        LlmProvider provider,
        String label,
        Instant createdAt,
        Instant lastUsedAt,
        String lastTestStatus,
        String lastTestMessage,
        Instant lastTestAt
) {
    public static CredentialResponse from(LlmCredential c) {
        return new CredentialResponse(
                c.getId(),
                c.getProvider(),
                c.getLabel(),
                c.getCreatedAt(),
                c.getLastUsedAt(),
                c.getLastTestStatus(),
                c.getLastTestMessage(),
                c.getLastTestAt()
        );
    }
}
