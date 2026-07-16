package ai.openapk.core.credentials;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.client.SimpleClientHttpRequestFactory;
import org.springframework.stereotype.Component;
import org.springframework.web.client.RestClient;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;

import java.time.Duration;
import java.time.Instant;
import java.util.ArrayList;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;

/**
 * Live model discovery for BYOK credentials — the thing that lets us stop
 * hardcoding an allowlist that goes stale every other day. Every OpenAI-compatible
 * provider and Anthropic expose a {@code GET /models} endpoint; we query it with
 * the user's stored key and cache the result briefly. The model picker populates
 * from this, and {@link ai.openapk.core.analysis.LlmInvoker#resolveModel} validates
 * a requested model against it.
 *
 * <p>Bedrock is the exception: "available models" there is a control-plane call
 * that doesn't reflect per-account access, so we serve a curated list.
 *
 * <p>Fetch failures return an empty list rather than throwing — callers treat
 * empty as "couldn't enumerate, don't block" so a flaky {@code /models} call
 * never breaks an otherwise-valid analysis.
 */
@Component
public class LlmModelCatalog {

    private static final Logger log = LoggerFactory.getLogger(LlmModelCatalog.class);
    private static final Duration TTL = Duration.ofMinutes(30);

    // Curated Bedrock set (per-region IDs + `us.` cross-region inference
    // profiles for the Claude 4 family). Users need model access enabled per ID.
    private static final List<String> BEDROCK_MODELS = List.of(
            "anthropic.claude-3-5-sonnet-20241022-v2:0",
            "anthropic.claude-3-5-haiku-20241022-v1:0",
            "anthropic.claude-3-opus-20240229-v1:0",
            "us.anthropic.claude-sonnet-4-20250514-v1:0",
            "us.anthropic.claude-opus-4-20250514-v1:0",
            "amazon.nova-pro-v1:0",
            "amazon.nova-lite-v1:0",
            "amazon.nova-micro-v1:0",
            "meta.llama3-3-70b-instruct-v1:0"
    );

    private record Cached(List<String> models, Instant fetchedAt) {}

    private final LlmCredentialEncryptionService crypto;
    private final LlmCredentialPayloadCodec codec;
    private final ObjectMapper mapper;
    private final RestClient http;
    private final Map<UUID, Cached> cache = new ConcurrentHashMap<>();

    public LlmModelCatalog(LlmCredentialEncryptionService crypto,
                           LlmCredentialPayloadCodec codec,
                           ObjectMapper mapper) {
        this.crypto = crypto;
        this.codec = codec;
        this.mapper = mapper;
        var factory = new SimpleClientHttpRequestFactory();
        factory.setConnectTimeout((int) Duration.ofSeconds(10).toMillis());
        factory.setReadTimeout((int) Duration.ofSeconds(20).toMillis());
        this.http = RestClient.builder().requestFactory(factory).build();
    }

    /** Model IDs available to this credential, cached for {@link #TTL}. Empty on failure. */
    public List<String> listModels(LlmCredential cred) {
        Cached c = cache.get(cred.getId());
        if (c != null && Duration.between(c.fetchedAt(), Instant.now()).compareTo(TTL) < 0) {
            return c.models();
        }
        List<String> models = fetch(cred);
        // Only cache a real result — don't pin a transient empty list.
        if (!models.isEmpty()) cache.put(cred.getId(), new Cached(models, Instant.now()));
        return models;
    }

    private List<String> fetch(LlmCredential cred) {
        LlmProvider provider = cred.getProvider();
        if (provider.kind() == LlmProvider.Kind.BEDROCK) return BEDROCK_MODELS;
        try {
            LlmCredentialPayload payload = decode(cred);
            return switch (provider.kind()) {
                case ANTHROPIC -> fetchAnthropic((LlmCredentialPayload.Anthropic) payload);
                case OPENAI -> fetchOpenAiCompatible(provider, (LlmCredentialPayload.OpenAI) payload);
                case BEDROCK -> BEDROCK_MODELS; // unreachable — handled above
            };
        } catch (Exception e) {
            log.warn("model list fetch failed for provider={}: {}", provider, e.toString());
            return List.of();
        }
    }

    private List<String> fetchAnthropic(LlmCredentialPayload.Anthropic p) {
        String body = http.get()
                .uri(LlmProvider.ANTHROPIC.baseUrl() + "/v1/models")
                .header("x-api-key", p.apiKey())
                .header("anthropic-version", "2023-06-01")
                .retrieve()
                .body(String.class);
        return parseData(body);
    }

    private List<String> fetchOpenAiCompatible(LlmProvider provider, LlmCredentialPayload.OpenAI p) {
        String base = provider.resolveBaseUrl(p.baseUrl());
        if (base == null || base.isBlank()) return List.of();
        String url = base.replaceAll("/+$", "") + "/models";
        String body = http.get()
                .uri(url)
                .header("Authorization", "Bearer " + p.apiKey())
                .retrieve()
                .body(String.class);
        return parseData(body);
    }

    /** Both Anthropic and OpenAI-compatible /models return {@code {"data":[{"id":...}]}}. */
    private List<String> parseData(String body) {
        try {
            JsonNode data = mapper.readTree(body).path("data");
            if (!data.isArray()) return List.of();
            Set<String> ids = new LinkedHashSet<>();
            for (JsonNode m : data) {
                String id = m.path("id").asString("");
                if (!id.isBlank()) ids.add(id);
            }
            return new ArrayList<>(ids);
        } catch (Exception e) {
            log.warn("failed to parse /models response: {}", e.toString());
            return List.of();
        }
    }

    private LlmCredentialPayload decode(LlmCredential c) {
        byte[] json = crypto.decrypt(c.getPayloadCiphertext(), c.getPayloadIv());
        return codec.fromJson(json, c.getProvider());
    }
}
