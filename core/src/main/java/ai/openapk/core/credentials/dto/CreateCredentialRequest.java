package ai.openapk.core.credentials.dto;

import ai.openapk.core.credentials.LlmProvider;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;

public record CreateCredentialRequest(
        @NotNull LlmProvider provider,
        @NotBlank @Size(max = 100) String label,
        String apiKey,
        // Only for the generic OPENAI_COMPAT provider — the OpenAI-compatible
        // API root the user is bringing. Ignored for named providers (their
        // base URL comes from the enum).
        @Size(max = 500) String baseUrl,
        String accessKeyId,
        String secretAccessKey,
        String sessionToken,
        String region
) {}
