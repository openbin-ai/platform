package ai.openapk.core.credentials;

public sealed interface LlmCredentialPayload {

    record Anthropic(String apiKey) implements LlmCredentialPayload {}

    record OpenAI(String apiKey) implements LlmCredentialPayload {}

    record Bedrock(
            String accessKeyId,
            String secretAccessKey,
            String sessionToken,
            String region
    ) implements LlmCredentialPayload {}
}
