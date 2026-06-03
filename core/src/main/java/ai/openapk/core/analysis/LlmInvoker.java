package ai.openapk.core.analysis;

import ai.openapk.core.auth.User;
import ai.openapk.core.credentials.LlmCredential;
import ai.openapk.core.credentials.LlmCredentialEncryptionService;
import ai.openapk.core.credentials.LlmCredentialPayload;
import ai.openapk.core.credentials.LlmCredentialPayloadCodec;
import ai.openapk.core.credentials.LlmProvider;
import ai.openapk.core.usage.LlmUsageService;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.HttpStatus;
import org.springframework.http.client.SimpleClientHttpRequestFactory;
import org.springframework.stereotype.Component;
import org.springframework.web.client.RestClient;
import org.springframework.web.server.ResponseStatusException;
import software.amazon.awssdk.auth.credentials.AwsBasicCredentials;
import software.amazon.awssdk.auth.credentials.AwsSessionCredentials;
import software.amazon.awssdk.auth.credentials.StaticCredentialsProvider;
import software.amazon.awssdk.regions.Region;
import software.amazon.awssdk.services.bedrockruntime.BedrockRuntimeClient;
import software.amazon.awssdk.services.bedrockruntime.model.ContentBlock;
import software.amazon.awssdk.services.bedrockruntime.model.ConversationRole;
import software.amazon.awssdk.services.bedrockruntime.model.ConverseResponse;
import software.amazon.awssdk.services.bedrockruntime.model.InferenceConfiguration;
import software.amazon.awssdk.services.bedrockruntime.model.Message;
import software.amazon.awssdk.services.bedrockruntime.model.SystemContentBlock;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;

import java.time.Duration;
import java.util.List;
import java.util.Map;
import java.util.Set;

/**
 * Calls the user's chosen LLM provider with their decrypted BYOK key. Raw HTTP via
 * RestClient — same pattern as the credential-test endpoint in slice 1, and stable
 * across Spring AI milestone churn. Migrate to Spring AI ChatClient when we need
 * streaming + tool calls (slice 3.5 / 4).
 */
@Component
public class LlmInvoker {

    private static final Logger log = LoggerFactory.getLogger(LlmInvoker.class);

    public static final String ANTHROPIC_DEFAULT_MODEL = "claude-sonnet-4-6";
    public static final String OPENAI_DEFAULT_MODEL = "gpt-5.1";
    // Sonnet 3.5 v2 is broadly available and doesn't require a cross-region
    // inference profile, so it's a safe default. Users on accounts with newer
    // models can override via the picker.
    public static final String BEDROCK_DEFAULT_MODEL = "anthropic.claude-3-5-sonnet-20241022-v2:0";

    /**
     * Allowlist of model IDs we accept from the client. Prevents arbitrary model
     * strings being passed through to the provider, and keeps the picker honest.
     */
    public static final Map<LlmProvider, Set<String>> ALLOWED_MODELS = Map.of(
            LlmProvider.ANTHROPIC, Set.of(
                    "claude-opus-4-7",
                    "claude-sonnet-4-6",
                    "claude-haiku-4-5"
            ),
            LlmProvider.OPENAI, Set.of(
                    "gpt-5.1",
                    "gpt-5",
                    "gpt-5-mini",
                    "gpt-5-nano",
                    "gpt-4o",
                    "gpt-4o-mini"
            ),
            // Bedrock model IDs differ from native: include both per-region IDs
            // (no prefix) for Sonnet/Haiku 3.5 + Nova + Llama, and `us.`-prefixed
            // cross-region inference profile IDs for Claude 4 family. Users need
            // model access enabled in their account for each.
            LlmProvider.BEDROCK, Set.of(
                    "anthropic.claude-3-5-sonnet-20241022-v2:0",
                    "anthropic.claude-3-5-haiku-20241022-v1:0",
                    "anthropic.claude-3-opus-20240229-v1:0",
                    "us.anthropic.claude-sonnet-4-20250514-v1:0",
                    "us.anthropic.claude-opus-4-20250514-v1:0",
                    "amazon.nova-pro-v1:0",
                    "amazon.nova-lite-v1:0",
                    "amazon.nova-micro-v1:0",
                    "meta.llama3-3-70b-instruct-v1:0"
            )
    );

    public record CompletionResult(String text, String model, int inputTokens, int outputTokens) {}

    private final LlmCredentialEncryptionService crypto;
    private final LlmCredentialPayloadCodec codec;
    private final ObjectMapper mapper;
    private final LlmUsageService usage;
    private final RestClient http;

    public LlmInvoker(
            LlmCredentialEncryptionService crypto,
            LlmCredentialPayloadCodec codec,
            ObjectMapper mapper,
            LlmUsageService usage
    ) {
        this.crypto = crypto;
        this.codec = codec;
        this.mapper = mapper;
        this.usage = usage;
        var factory = new SimpleClientHttpRequestFactory();
        factory.setConnectTimeout((int) Duration.ofSeconds(15).toMillis());
        factory.setReadTimeout((int) Duration.ofSeconds(180).toMillis());
        this.http = RestClient.builder().requestFactory(factory).build();
    }

    public CompletionResult complete(
            User user,
            java.util.UUID projectId,
            String purpose,
            LlmCredential credential,
            String systemPrompt,
            String userPrompt,
            int maxTokens,
            String requestedModel
    ) {
        usage.checkBudget(user);
        String model = resolveModel(credential.getProvider(), requestedModel);
        var payload = decode(credential);
        String providerStr = credential.getProvider().name();
        try {
            CompletionResult result = switch (credential.getProvider()) {
                case ANTHROPIC -> callAnthropic((LlmCredentialPayload.Anthropic) payload, model, systemPrompt, userPrompt, maxTokens);
                case OPENAI -> callOpenAi((LlmCredentialPayload.OpenAI) payload, model, systemPrompt, userPrompt, maxTokens);
                case BEDROCK -> callBedrock((LlmCredentialPayload.Bedrock) payload, model, systemPrompt, userPrompt, maxTokens);
            };
            usage.record(user, projectId, providerStr, result.model(), purpose,
                    result.inputTokens(), result.outputTokens(), true, null);
            return result;
        } catch (ResponseStatusException e) {
            usage.record(user, projectId, providerStr, model, purpose, 0, 0, false, e.getReason());
            throw e;
        } catch (Exception e) {
            log.warn("LLM call failed for provider={} model={}: {}", credential.getProvider(), model, e.toString());
            usage.record(user, projectId, providerStr, model, purpose, 0, 0, false, e.toString());
            throw new ResponseStatusException(HttpStatus.BAD_GATEWAY, "Upstream LLM call failed: " + abbreviate(e.getMessage()));
        }
    }

    public String resolveModel(LlmProvider provider, String requested) {
        String defaultModel = switch (provider) {
            case ANTHROPIC -> ANTHROPIC_DEFAULT_MODEL;
            case OPENAI -> OPENAI_DEFAULT_MODEL;
            case BEDROCK -> BEDROCK_DEFAULT_MODEL;
        };
        if (requested == null || requested.isBlank()) return defaultModel;
        Set<String> allowed = ALLOWED_MODELS.getOrDefault(provider, Set.of());
        if (!allowed.contains(requested)) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST,
                    "Model '" + requested + "' not allowed for provider " + provider + ". Allowed: " + allowed);
        }
        return requested;
    }

    private CompletionResult callAnthropic(LlmCredentialPayload.Anthropic p, String model, String systemPrompt, String userPrompt, int maxTokens) {
        var body = Map.of(
                "model", model,
                "max_tokens", maxTokens,
                "system", systemPrompt,
                "messages", List.of(Map.of("role", "user", "content", userPrompt))
        );
        String responseText = http.post()
                .uri("https://api.anthropic.com/v1/messages")
                .header("x-api-key", p.apiKey())
                .header("anthropic-version", "2023-06-01")
                .header("content-type", "application/json")
                .body(body)
                .retrieve()
                .body(String.class);
        try {
            JsonNode root = mapper.readTree(responseText);
            JsonNode content = root.path("content");
            StringBuilder sb = new StringBuilder();
            if (content.isArray()) {
                for (JsonNode part : content) {
                    if ("text".equals(part.path("type").asString(""))) {
                        sb.append(part.path("text").asString(""));
                    }
                }
            }
            if (sb.isEmpty()) throw new IllegalStateException("Anthropic returned no text content");
            JsonNode usage = root.path("usage");
            int in = usage.path("input_tokens").asInt(0);
            int out = usage.path("output_tokens").asInt(0);
            return new CompletionResult(sb.toString(), model, in, out);
        } catch (Exception e) {
            throw new IllegalStateException("Failed to parse Anthropic response: " + e.getMessage(), e);
        }
    }

    private CompletionResult callOpenAi(LlmCredentialPayload.OpenAI p, String model, String systemPrompt, String userPrompt, int maxTokens) {
        var body = Map.of(
                "model", model,
                "max_completion_tokens", maxTokens,
                "messages", List.of(
                        Map.of("role", "system", "content", systemPrompt),
                        Map.of("role", "user", "content", userPrompt)
                )
        );
        String responseText = http.post()
                .uri("https://api.openai.com/v1/chat/completions")
                .header("Authorization", "Bearer " + p.apiKey())
                .header("content-type", "application/json")
                .body(body)
                .retrieve()
                .body(String.class);
        try {
            JsonNode root = mapper.readTree(responseText);
            JsonNode choices = root.path("choices");
            String text;
            if (choices.isArray() && !choices.isEmpty()) {
                text = choices.get(0).path("message").path("content").asString("");
            } else {
                throw new IllegalStateException("OpenAI returned no choices");
            }
            JsonNode usage = root.path("usage");
            int in = usage.path("prompt_tokens").asInt(0);
            int out = usage.path("completion_tokens").asInt(0);
            return new CompletionResult(text, model, in, out);
        } catch (Exception e) {
            throw new IllegalStateException("Failed to parse OpenAI response: " + e.getMessage(), e);
        }
    }

    private CompletionResult callBedrock(LlmCredentialPayload.Bedrock p, String model, String systemPrompt, String userPrompt, int maxTokens) {
        // BedrockRuntimeClient holds an Apache HttpClient under the hood — cheap
        // to build for a single sync call, but if Bedrock becomes the hot path
        // we should cache per-credential. try-with-resources guarantees release.
        try (BedrockRuntimeClient client = bedrockClient(p)) {
            ConverseResponse resp = client.converse(req -> req
                    .modelId(model)
                    .system(SystemContentBlock.builder().text(systemPrompt).build())
                    .messages(Message.builder()
                            .role(ConversationRole.USER)
                            .content(ContentBlock.fromText(userPrompt))
                            .build())
                    .inferenceConfig(InferenceConfiguration.builder()
                            .maxTokens(maxTokens)
                            .build()));
            List<ContentBlock> blocks = resp.output().message().content();
            StringBuilder sb = new StringBuilder();
            for (ContentBlock block : blocks) {
                if (block.text() != null) sb.append(block.text());
            }
            if (sb.isEmpty()) throw new IllegalStateException("Bedrock returned no text content");
            int in = resp.usage().inputTokens() != null ? resp.usage().inputTokens() : 0;
            int out = resp.usage().outputTokens() != null ? resp.usage().outputTokens() : 0;
            return new CompletionResult(sb.toString(), model, in, out);
        }
    }

    /**
     * Build a sync Bedrock client from a stored BYOK credential. Session token
     * is optional (only set when the caller obtained temporary STS creds).
     */
    public static BedrockRuntimeClient bedrockClient(LlmCredentialPayload.Bedrock p) {
        var creds = (p.sessionToken() != null && !p.sessionToken().isBlank())
                ? AwsSessionCredentials.create(p.accessKeyId(), p.secretAccessKey(), p.sessionToken())
                : AwsBasicCredentials.create(p.accessKeyId(), p.secretAccessKey());
        return BedrockRuntimeClient.builder()
                .region(Region.of(p.region()))
                .credentialsProvider(StaticCredentialsProvider.create(creds))
                .build();
    }

    public LlmCredentialPayload decodePayload(LlmCredential c) {
        byte[] json = crypto.decrypt(c.getPayloadCiphertext(), c.getPayloadIv());
        return codec.fromJson(json, c.getProvider());
    }

    private LlmCredentialPayload decode(LlmCredential c) {
        return decodePayload(c);
    }

    public LlmProvider provider(LlmCredential c) { return c.getProvider(); }

    private static String abbreviate(String s) {
        if (s == null) return "unknown error";
        return s.length() > 240 ? s.substring(0, 240) + "…" : s;
    }
}
