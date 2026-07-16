package ai.openapk.core.credentials;

public sealed interface LlmCredentialPayload {

    record Anthropic(String apiKey) implements LlmCredentialPayload {}

    /**
     * Any OpenAI-compatible provider (OpenAI, Gemini, DeepSeek, Qwen, Kimi, or a
     * generic OPENAI_COMPAT). {@code baseUrl} is null for the named presets
     * (the provider enum supplies it) and set for OPENAI_COMPAT where the user
     * brings their own endpoint. Old stored payloads that predate this field
     * deserialize {@code baseUrl} to null, which correctly falls back to the
     * enum default.
     */
    record OpenAI(String apiKey, String baseUrl) implements LlmCredentialPayload {}

    record Bedrock(
            String accessKeyId,
            String secretAccessKey,
            String sessionToken,
            String region
    ) implements LlmCredentialPayload {}
}
