package ai.openapk.core.credentials;

import ai.openapk.core.analysis.LlmInvoker;
import ai.openapk.core.credentials.dto.TestResultResponse;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Component;
import org.springframework.web.client.RestClient;
import software.amazon.awssdk.services.bedrockruntime.BedrockRuntimeClient;
import software.amazon.awssdk.services.bedrockruntime.model.ContentBlock;
import software.amazon.awssdk.services.bedrockruntime.model.ConversationRole;
import software.amazon.awssdk.services.bedrockruntime.model.ConverseResponse;
import software.amazon.awssdk.services.bedrockruntime.model.InferenceConfiguration;
import software.amazon.awssdk.services.bedrockruntime.model.Message;
import software.amazon.awssdk.services.bedrockruntime.model.SystemContentBlock;

import java.time.Duration;

@Component
public class LlmCredentialTester {

    private static final Logger log = LoggerFactory.getLogger(LlmCredentialTester.class);

    // Redirects off (see OutboundLlmHttp) — this client is pointed at a
    // user-supplied base URL. Timeouts were also missing entirely here, so a
    // hostile endpoint that accepted the connection and never answered pinned
    // a request thread indefinitely.
    private final RestClient http = OutboundLlmHttp.restClient(
            Duration.ofSeconds(10), Duration.ofSeconds(20));

    public TestResultResponse test(LlmProvider provider, LlmCredentialPayload payload) {
        try {
            return switch (provider.kind()) {
                case ANTHROPIC -> testAnthropic((LlmCredentialPayload.Anthropic) payload);
                case OPENAI -> testOpenAiCompatible(provider, (LlmCredentialPayload.OpenAI) payload);
                case BEDROCK -> testBedrock((LlmCredentialPayload.Bedrock) payload);
            };
        } catch (Exception e) {
            log.warn("credential test failed: provider={} cause={}", provider, e.toString());
            return new TestResultResponse("error", abbreviate(e.getMessage()));
        }
    }

    // Test via GET /models rather than a 1-token completion: it validates the
    // key + base URL + connectivity, costs nothing, and needs no model name —
    // which matters for the generic OPENAI_COMPAT provider where we can't guess
    // a valid model.
    private TestResultResponse testAnthropic(LlmCredentialPayload.Anthropic p) {
        var resp = http.get()
                .uri(LlmProvider.ANTHROPIC.baseUrl() + "/v1/models")
                .header("x-api-key", p.apiKey())
                .header("anthropic-version", "2023-06-01")
                .retrieve()
                .toEntity(String.class);
        return new TestResultResponse("ok", "Anthropic responded HTTP " + resp.getStatusCode().value());
    }

    private TestResultResponse testOpenAiCompatible(LlmProvider provider, LlmCredentialPayload.OpenAI p) {
        String base = provider.resolveBaseUrl(p.baseUrl());
        if (base == null || base.isBlank()) {
            return new TestResultResponse("error", "No base URL configured for provider " + provider);
        }
        var resp = http.get()
                .uri(base.replaceAll("/+$", "") + "/models")
                .header("Authorization", "Bearer " + p.apiKey())
                .retrieve()
                .toEntity(String.class);
        return new TestResultResponse("ok", provider + " responded HTTP " + resp.getStatusCode().value());
    }

    /**
     * Minimum-cost Converse call: 1 output token from a small model. Verifies
     * both that the AWS creds are valid AND that Bedrock model access is enabled
     * in this account/region — both are common failure modes for new users.
     */
    private TestResultResponse testBedrock(LlmCredentialPayload.Bedrock p) {
        try (BedrockRuntimeClient client = LlmInvoker.bedrockClient(p)) {
            ConverseResponse resp = client.converse(req -> req
                    .modelId("anthropic.claude-3-5-haiku-20241022-v1:0")
                    .system(SystemContentBlock.builder().text("Reply with one word.").build())
                    .messages(Message.builder()
                            .role(ConversationRole.USER)
                            .content(ContentBlock.fromText("hi"))
                            .build())
                    .inferenceConfig(InferenceConfiguration.builder().maxTokens(1).build()));
            String stop = resp.stopReasonAsString();
            return new TestResultResponse("ok",
                    "Bedrock responded in " + p.region() + " (stopReason=" + stop + ")");
        }
    }

    private static String abbreviate(String s) {
        if (s == null) return "unknown error";
        return s.length() > 240 ? s.substring(0, 240) + "…" : s;
    }
}
