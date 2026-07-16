package ai.openapk.core.analysis;

import ai.openapk.core.auth.User;
import ai.openapk.core.credentials.LlmCredential;
import ai.openapk.core.credentials.LlmCredentialPayload;
import ai.openapk.core.credentials.LlmProvider;
import ai.openapk.core.usage.LlmUsageService;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Component;
import org.springframework.web.server.ResponseStatusException;
import software.amazon.awssdk.services.bedrockruntime.BedrockRuntimeAsyncClient;
import software.amazon.awssdk.services.bedrockruntime.model.ContentBlock;
import software.amazon.awssdk.services.bedrockruntime.model.ConversationRole;
import software.amazon.awssdk.services.bedrockruntime.model.InferenceConfiguration;
import software.amazon.awssdk.services.bedrockruntime.model.Message;
import software.amazon.awssdk.services.bedrockruntime.model.SystemContentBlock;
import software.amazon.awssdk.services.bedrockruntime.model.TokenUsage;
import software.amazon.awssdk.services.bedrockruntime.model.ConverseStreamResponseHandler;
import software.amazon.awssdk.auth.credentials.AwsBasicCredentials;
import software.amazon.awssdk.auth.credentials.AwsSessionCredentials;
import software.amazon.awssdk.auth.credentials.StaticCredentialsProvider;
import software.amazon.awssdk.regions.Region;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;

import java.io.BufferedReader;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.util.List;
import java.util.Map;
import java.util.concurrent.atomic.AtomicReference;

/**
 * Streaming variant of {@link LlmInvoker}. Uses JDK HttpClient with an InputStream
 * body so SSE events arrive incrementally — RestClient buffers, which would block
 * the whole response.
 */
@Component
public class StreamingLlmInvoker {

    private static final Logger log = LoggerFactory.getLogger(StreamingLlmInvoker.class);

    public interface StreamCallback {
        void onChunk(String text);
        void onDone(String model, int inputTokens, int outputTokens);
        void onError(Throwable t);
    }

    private final LlmInvoker invoker;
    private final ObjectMapper mapper;
    private final LlmUsageService usage;
    private final HttpClient httpClient;

    public StreamingLlmInvoker(LlmInvoker invoker, ObjectMapper mapper, LlmUsageService usage) {
        this.invoker = invoker;
        this.mapper = mapper;
        this.usage = usage;
        this.httpClient = HttpClient.newBuilder()
                .connectTimeout(Duration.ofSeconds(15))
                .build();
    }

    public void stream(
            User user,
            java.util.UUID projectId,
            String purpose,
            LlmCredential cred,
            String systemPrompt,
            String userPrompt,
            int maxTokens,
            String requestedModel,
            StreamCallback callback
    ) {
        try {
            usage.checkBudget(user);
        } catch (ResponseStatusException e) {
            callback.onError(e);
            return;
        }

        String model;
        LlmCredentialPayload payload;
        try {
            model = invoker.resolveModel(cred, requestedModel);
            payload = invoker.decodePayload(cred);
        } catch (ResponseStatusException e) {
            callback.onError(e);
            return;
        } catch (Exception e) {
            callback.onError(new IllegalStateException("Could not prepare credential: " + e.getMessage(), e));
            return;
        }

        // Wrap the caller's callback so audit recording happens regardless of
        // which terminal event the stream produces (onDone or onError). We can't
        // do this in a try/finally because streaming completes asynchronously.
        String providerStr = cred.getProvider().name();
        StreamCallback auditing = new StreamCallback() {
            @Override public void onChunk(String text) { callback.onChunk(text); }
            @Override public void onDone(String modelUsed, int inputTokens, int outputTokens) {
                usage.record(user, projectId, providerStr, modelUsed, purpose,
                        inputTokens, outputTokens, true, null);
                callback.onDone(modelUsed, inputTokens, outputTokens);
            }
            @Override public void onError(Throwable t) {
                usage.record(user, projectId, providerStr, model, purpose, 0, 0, false,
                        t.getMessage() == null ? t.getClass().getSimpleName() : t.getMessage());
                callback.onError(t);
            }
        };

        try {
            switch (cred.getProvider().kind()) {
                case ANTHROPIC -> streamAnthropic((LlmCredentialPayload.Anthropic) payload, model, systemPrompt, userPrompt, maxTokens, auditing);
                case OPENAI -> streamOpenAi((LlmCredentialPayload.OpenAI) payload, cred.getProvider(), model, systemPrompt, userPrompt, maxTokens, auditing);
                case BEDROCK -> streamBedrock((LlmCredentialPayload.Bedrock) payload, model, systemPrompt, userPrompt, maxTokens, auditing);
            }
        } catch (Exception e) {
            log.warn("streaming call failed: provider={} model={}: {}", cred.getProvider(), model, e.toString());
            auditing.onError(e);
        }
    }

    private void streamAnthropic(
            LlmCredentialPayload.Anthropic p, String model, String systemPrompt, String userPrompt, int maxTokens,
            StreamCallback cb
    ) throws Exception {
        String json = mapper.writeValueAsString(Map.of(
                "model", model,
                "max_tokens", maxTokens,
                "stream", true,
                "system", systemPrompt,
                "messages", List.of(Map.of("role", "user", "content", userPrompt))
        ));
        var req = HttpRequest.newBuilder()
                .uri(URI.create("https://api.anthropic.com/v1/messages"))
                .header("x-api-key", p.apiKey())
                .header("anthropic-version", "2023-06-01")
                .header("content-type", "application/json")
                .header("accept", "text/event-stream")
                .timeout(Duration.ofSeconds(180))
                .POST(HttpRequest.BodyPublishers.ofString(json))
                .build();
        HttpResponse<InputStream> resp = httpClient.send(req, HttpResponse.BodyHandlers.ofInputStream());
        if (resp.statusCode() / 100 != 2) {
            String body = new String(resp.body().readAllBytes(), StandardCharsets.UTF_8);
            throw new IllegalStateException("Anthropic returned " + resp.statusCode() + ": " + abbreviate(body));
        }

        int inputTokens = 0;
        int outputTokens = 0;
        try (var reader = new BufferedReader(new InputStreamReader(resp.body(), StandardCharsets.UTF_8))) {
            String line;
            while ((line = reader.readLine()) != null) {
                if (!line.startsWith("data: ")) continue;
                String data = line.substring(6);
                if (data.isEmpty()) continue;
                JsonNode evt = mapper.readTree(data);
                String type = evt.path("type").asString("");
                switch (type) {
                    case "message_start" -> {
                        int in = evt.path("message").path("usage").path("input_tokens").asInt(0);
                        if (in > 0) inputTokens = in;
                    }
                    case "content_block_delta" -> {
                        if ("text_delta".equals(evt.path("delta").path("type").asString(""))) {
                            String text = evt.path("delta").path("text").asString("");
                            if (!text.isEmpty()) cb.onChunk(text);
                        }
                    }
                    case "message_delta" -> {
                        int out = evt.path("usage").path("output_tokens").asInt(outputTokens);
                        if (out > 0) outputTokens = out;
                    }
                    default -> { /* message_stop, content_block_start/stop, ping — ignore */ }
                }
            }
        }
        cb.onDone(model, inputTokens, outputTokens);
    }

    private void streamOpenAi(
            LlmCredentialPayload.OpenAI p, LlmProvider provider, String model, String systemPrompt, String userPrompt, int maxTokens,
            StreamCallback cb
    ) throws Exception {
        String json = mapper.writeValueAsString(Map.of(
                "model", model,
                "max_completion_tokens", maxTokens,
                "stream", true,
                "stream_options", Map.of("include_usage", true),
                "messages", List.of(
                        Map.of("role", "system", "content", systemPrompt),
                        Map.of("role", "user", "content", userPrompt)
                )
        ));
        var req = HttpRequest.newBuilder()
                .uri(URI.create(LlmInvoker.openAiChatUrl(provider, p)))
                .header("Authorization", "Bearer " + p.apiKey())
                .header("content-type", "application/json")
                .header("accept", "text/event-stream")
                .timeout(Duration.ofSeconds(180))
                .POST(HttpRequest.BodyPublishers.ofString(json))
                .build();
        HttpResponse<InputStream> resp = httpClient.send(req, HttpResponse.BodyHandlers.ofInputStream());
        if (resp.statusCode() / 100 != 2) {
            String body = new String(resp.body().readAllBytes(), StandardCharsets.UTF_8);
            throw new IllegalStateException("OpenAI returned " + resp.statusCode() + ": " + abbreviate(body));
        }

        int inputTokens = 0;
        int outputTokens = 0;
        try (var reader = new BufferedReader(new InputStreamReader(resp.body(), StandardCharsets.UTF_8))) {
            String line;
            while ((line = reader.readLine()) != null) {
                if (!line.startsWith("data: ")) continue;
                String data = line.substring(6).trim();
                if (data.isEmpty() || "[DONE]".equals(data)) continue;
                JsonNode evt = mapper.readTree(data);
                JsonNode choices = evt.path("choices");
                if (choices.isArray() && !choices.isEmpty()) {
                    String text = choices.get(0).path("delta").path("content").asString("");
                    if (!text.isEmpty()) cb.onChunk(text);
                }
                JsonNode usage = evt.path("usage");
                if (!usage.isMissingNode()) {
                    inputTokens = usage.path("prompt_tokens").asInt(inputTokens);
                    outputTokens = usage.path("completion_tokens").asInt(outputTokens);
                }
            }
        }
        cb.onDone(model, inputTokens, outputTokens);
    }

    private void streamBedrock(
            LlmCredentialPayload.Bedrock p, String model, String systemPrompt, String userPrompt, int maxTokens,
            StreamCallback cb
    ) {
        // Async client is heavier than the sync one (Netty under the hood) but
        // converseStream requires it. We build per-call and close in try-with-resources
        // — adequate for current call volume; revisit if Bedrock becomes hot.
        try (BedrockRuntimeAsyncClient client = asyncClient(p)) {
            AtomicReference<Throwable> errorRef = new AtomicReference<>();
            AtomicReference<TokenUsage> usageRef = new AtomicReference<>();

            var handler = ConverseStreamResponseHandler.builder()
                    .subscriber(ConverseStreamResponseHandler.Visitor.builder()
                            .onContentBlockDelta(evt -> {
                                String text = evt.delta() != null ? evt.delta().text() : null;
                                if (text != null && !text.isEmpty()) cb.onChunk(text);
                            })
                            .onMetadata(evt -> {
                                if (evt.usage() != null) usageRef.set(evt.usage());
                            })
                            .build())
                    .onError(errorRef::set)
                    .build();

            client.converseStream(req -> req
                    .modelId(model)
                    .system(SystemContentBlock.builder().text(systemPrompt).build())
                    .messages(Message.builder()
                            .role(ConversationRole.USER)
                            .content(ContentBlock.fromText(userPrompt))
                            .build())
                    .inferenceConfig(InferenceConfiguration.builder()
                            .maxTokens(maxTokens)
                            .build()),
                    handler
            ).join(); // join() rethrows handler/transport errors as CompletionException

            if (errorRef.get() != null) {
                cb.onError(errorRef.get());
                return;
            }
            TokenUsage u = usageRef.get();
            int in = (u != null && u.inputTokens() != null) ? u.inputTokens() : 0;
            int out = (u != null && u.outputTokens() != null) ? u.outputTokens() : 0;
            cb.onDone(model, in, out);
        } catch (Exception e) {
            cb.onError(e);
        }
    }

    private static BedrockRuntimeAsyncClient asyncClient(LlmCredentialPayload.Bedrock p) {
        var creds = (p.sessionToken() != null && !p.sessionToken().isBlank())
                ? AwsSessionCredentials.create(p.accessKeyId(), p.secretAccessKey(), p.sessionToken())
                : AwsBasicCredentials.create(p.accessKeyId(), p.secretAccessKey());
        return BedrockRuntimeAsyncClient.builder()
                .region(Region.of(p.region()))
                .credentialsProvider(StaticCredentialsProvider.create(creds))
                .build();
    }

    private static String abbreviate(String s) {
        if (s == null) return "";
        return s.length() > 240 ? s.substring(0, 240) + "…" : s;
    }
}
