package ai.openapk.core.credentials.dto;

import ai.openapk.core.credentials.LlmProvider;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;

public record CreateCredentialRequest(
        @NotNull LlmProvider provider,
        @NotBlank @Size(max = 100) String label,
        String apiKey,
        String accessKeyId,
        String secretAccessKey,
        String sessionToken,
        String region
) {}
