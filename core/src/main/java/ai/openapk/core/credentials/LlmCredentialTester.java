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

import java.util.List;
import java.util.Map;

@Component
public class LlmCredentialTester {

    private static final Logger log = LoggerFactory.getLogger(LlmCredentialTester.class);

    private final RestClient http = RestClient.builder().build();

    public TestResultResponse test(LlmProvider provider, LlmCredentialPayload payload) {
        try {
            return switch (provider) {
                case ANTHROPIC -> testAnthropic((LlmCredentialPayload.Anthropic) payload);
                case OPENAI -> testOpenAi((LlmCredentialPayload.OpenAI) payload);
                case BEDROCK -> testBedrock((LlmCredentialPayload.Bedrock) payload);
            };
        } catch (Exception e) {
            log.warn("credential test failed: provider={} cause={}", provider, e.toString());
            return new TestResultResponse("error", abbreviate(e.getMessage()));
        }
    }

    private TestResultResponse testAnthropic(LlmCredentialPayload.Anthropic p) {
        var body = Map.of(
                "model", "claude-haiku-4-5",
                "max_tokens", 1,
                "messages", List.of(Map.of("role", "user", "content", "hi"))
        );
        var resp = http.post()
                .uri("https://api.anthropic.com/v1/messages")
                .header("x-api-key", p.apiKey())
                .header("anthropic-version", "2023-06-01")
                .header("content-type", "application/json")
                .body(body)
                .retrieve()
                .toEntity(String.class);
        return new TestResultResponse("ok", "Anthropic responded HTTP " + resp.getStatusCode().value());
    }

    private TestResultResponse testOpenAi(LlmCredentialPayload.OpenAI p) {
        var body = Map.of(
                "model", "gpt-4o-mini",
                "max_tokens", 1,
                "messages", List.of(Map.of("role", "user", "content", "hi"))
        );
        var resp = http.post()
                .uri("https://api.openai.com/v1/chat/completions")
                .header("Authorization", "Bearer " + p.apiKey())
                .header("content-type", "application/json")
                .body(body)
                .retrieve()
                .toEntity(String.class);
        return new TestResultResponse("ok", "OpenAI responded HTTP " + resp.getStatusCode().value());
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
