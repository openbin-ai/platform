package ai.openapk.core.analysis.agent;

import ai.openapk.core.analysis.LlmInvoker;
import ai.openapk.core.auth.User;
import ai.openapk.core.credentials.LlmCredential;
import ai.openapk.core.credentials.LlmCredentialPayload;
import ai.openapk.core.credentials.LlmEndpoints;
import ai.openapk.core.credentials.LlmProvider;
import ai.openapk.core.credentials.OutboundLlmHttp;
import ai.openapk.core.usage.LlmUsageService;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Component;
import org.springframework.web.server.ResponseStatusException;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;
import tools.jackson.databind.node.ArrayNode;
import tools.jackson.databind.node.ObjectNode;

import java.io.BufferedReader;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;

/**
 * One streamed agent turn: a full message history plus tool definitions in,
 * the assistant's text and tool_use blocks out. Sibling of
 * {@link ai.openapk.core.analysis.StreamingLlmInvoker}, which only knows
 * {system, one user string} and text deltas; this is the path the agent loop
 * calls repeatedly, feeding tool results back as the next USER message.
 *
 * <p>Budget check, credential decode, model resolution, audit recording and
 * the HTTP client policy are all the same as the existing invokers so a
 * tool-calling turn is governed exactly like a plain one.
 */
@Component
public class ToolLlmInvoker {

    private static final Logger log = LoggerFactory.getLogger(ToolLlmInvoker.class);

    private static final Duration CONNECT_TIMEOUT = Duration.ofSeconds(15);
    private static final Duration REQUEST_TIMEOUT = Duration.ofSeconds(180);

    /**
     * Where a turn is sent. Production resolves through the egress-checked
     * builders; tests substitute a loopback server, which those builders
     * rightly refuse.
     */
    interface Endpoints {
        String anthropicMessages(LlmCredentialPayload.Anthropic p);
        String openAiChat(LlmProvider provider, LlmCredentialPayload.OpenAI p);

        Endpoints PRODUCTION = new Endpoints() {
            @Override public String anthropicMessages(LlmCredentialPayload.Anthropic p) {
                return LlmEndpoints.anthropicMessagesUrl(p);
            }
            @Override public String openAiChat(LlmProvider provider, LlmCredentialPayload.OpenAI p) {
                return LlmInvoker.openAiChatUrl(provider, p);
            }
        };
    }

    private final LlmInvoker invoker;
    private final ObjectMapper mapper;
    private final LlmUsageService usage;
    private final HttpClient httpClient;
    private final Endpoints endpoints;

    @Autowired
    public ToolLlmInvoker(LlmInvoker invoker, ObjectMapper mapper, LlmUsageService usage) {
        this(invoker, mapper, usage, OutboundLlmHttp.streamingClient(CONNECT_TIMEOUT), Endpoints.PRODUCTION);
    }

    ToolLlmInvoker(LlmInvoker invoker, ObjectMapper mapper, LlmUsageService usage,
                   HttpClient httpClient, Endpoints endpoints) {
        this.invoker = invoker;
        this.mapper = mapper;
        this.usage = usage;
        this.httpClient = httpClient;
        this.endpoints = endpoints;
    }

    /**
     * Run one turn and block until the model stops. Text deltas and tool-call
     * starts are reported through {@code cb} as they arrive; the returned
     * result holds the complete assistant output.
     *
     * @throws UnsupportedOperationException for Bedrock credentials, before any
     *         budget check or audit row, so the caller can fall back to the
     *         plain text stream without leaving a failed-call trace.
     * @throws ResponseStatusException 429 when over budget, 400 for a bad
     *         model or base URL, 502 when the upstream call fails.
     */
    public TurnResult streamTurn(
            User user,
            UUID projectId,
            String purpose,
            LlmCredential cred,
            String systemPrompt,
            List<ChatMessage> messages,
            List<ToolDef> tools,
            int maxTokens,
            String requestedModel,
            TurnCallback cb
    ) {
        if (cred.getProvider().kind() == LlmProvider.Kind.BEDROCK) {
            throw new UnsupportedOperationException("tool use is not supported on Bedrock yet");
        }
        usage.checkBudget(user);
        LlmCredentialPayload payload = invoker.decodePayload(cred);
        String model = invoker.resolveModel(cred, requestedModel);
        String providerStr = cred.getProvider().name();
        List<ToolDef> toolList = tools == null ? List.of() : tools;
        TurnCallback callback = cb == null ? NOOP : cb;
        try {
            TurnResult result = switch (cred.getProvider().kind()) {
                case ANTHROPIC -> anthropicTurn((LlmCredentialPayload.Anthropic) payload, model,
                        systemPrompt, messages, toolList, maxTokens, callback);
                case OPENAI -> openAiTurn((LlmCredentialPayload.OpenAI) payload, cred.getProvider(), model,
                        systemPrompt, messages, toolList, maxTokens, callback);
                case BEDROCK -> throw new UnsupportedOperationException("tool use is not supported on Bedrock yet");
            };
            usage.record(user, projectId, providerStr, result.model(), purpose,
                    result.inputTokens(), result.outputTokens(), true, null);
            return result;
        } catch (ResponseStatusException e) {
            usage.record(user, projectId, providerStr, model, purpose, 0, 0, false, e.getReason());
            throw e;
        } catch (Exception e) {
            log.warn("tool turn failed: provider={} model={}: {}", cred.getProvider(), model, e.toString());
            usage.record(user, projectId, providerStr, model, purpose, 0, 0, false, e.toString());
            throw new ResponseStatusException(HttpStatus.BAD_GATEWAY, "Upstream LLM call failed: " + abbreviate(e.getMessage()));
        }
    }

    // ---------------------------------------------------------------- Anthropic

    private TurnResult anthropicTurn(
            LlmCredentialPayload.Anthropic p, String model, String systemPrompt,
            List<ChatMessage> messages, List<ToolDef> tools, int maxTokens, TurnCallback cb
    ) throws Exception {
        ObjectNode body = mapper.createObjectNode();
        body.put("model", model);
        body.put("max_tokens", maxTokens);
        body.put("stream", true);
        if (systemPrompt != null && !systemPrompt.isBlank()) {
            // A block, not a string, so the cache breakpoint has somewhere to
            // sit: the system prompt is identical across every turn of a loop.
            ObjectNode sys = body.putArray("system").addObject();
            sys.put("type", "text");
            sys.put("text", systemPrompt);
            sys.putObject("cache_control").put("type", "ephemeral");
        }
        body.set("messages", anthropicMessages(messages));
        if (!tools.isEmpty()) {
            ArrayNode arr = body.putArray("tools");
            for (ToolDef t : tools) {
                ObjectNode tn = arr.addObject();
                tn.put("name", t.name());
                if (t.description() != null && !t.description().isBlank()) tn.put("description", t.description());
                tn.set("input_schema", t.inputSchema() == null ? mapper.createObjectNode() : t.inputSchema());
            }
        }

        var req = HttpRequest.newBuilder()
                .uri(URI.create(endpoints.anthropicMessages(p)))
                .header("x-api-key", p.apiKey())
                .header("anthropic-version", "2023-06-01")
                .header("content-type", "application/json")
                .header("accept", "text/event-stream")
                .timeout(REQUEST_TIMEOUT)
                .POST(HttpRequest.BodyPublishers.ofString(mapper.writeValueAsString(body)))
                .build();
        HttpResponse<InputStream> resp = httpClient.send(req, HttpResponse.BodyHandlers.ofInputStream());
        if (resp.statusCode() / 100 != 2) {
            String err = new String(resp.body().readAllBytes(), StandardCharsets.UTF_8);
            throw new IllegalStateException("Anthropic returned " + resp.statusCode() + ": " + abbreviate(err));
        }

        // Blocks are keyed by stream index because deltas for one block can be
        // interleaved with events for others only by index.
        Map<Integer, BlockAcc> byIndex = new LinkedHashMap<>();
        int inputTokens = 0;
        int outputTokens = 0;
        StopReason stop = StopReason.END_TURN;

        try (var reader = new BufferedReader(new InputStreamReader(resp.body(), StandardCharsets.UTF_8))) {
            String data;
            while ((data = nextSseData(reader)) != null) {
                JsonNode evt = mapper.readTree(data);
                String type = evt.path("type").asString("");
                switch (type) {
                    case "error" -> throw new IllegalStateException("Anthropic stream error: "
                            + evt.path("error").path("message").asString("unknown"));
                    case "message_start" -> {
                        int in = evt.path("message").path("usage").path("input_tokens").asInt(0);
                        if (in > 0) inputTokens = in;
                    }
                    case "content_block_start" -> {
                        int idx = evt.path("index").asInt(byIndex.size());
                        JsonNode cbNode = evt.path("content_block");
                        BlockAcc acc = new BlockAcc();
                        if ("tool_use".equals(cbNode.path("type").asString(""))) {
                            acc.toolUse = true;
                            acc.id = cbNode.path("id").asString("");
                            acc.name = cbNode.path("name").asString("");
                            cb.onToolUseStart(acc.id, acc.name);
                        } else {
                            // Anthropic may send the opening text in the start event itself.
                            acc.text.append(cbNode.path("text").asString(""));
                        }
                        byIndex.put(idx, acc);
                    }
                    case "content_block_delta" -> {
                        BlockAcc acc = byIndex.get(evt.path("index").asInt(-1));
                        if (acc == null) continue;
                        JsonNode delta = evt.path("delta");
                        switch (delta.path("type").asString("")) {
                            case "text_delta" -> {
                                String t = delta.path("text").asString("");
                                if (!t.isEmpty()) {
                                    acc.text.append(t);
                                    cb.onText(t);
                                }
                            }
                            case "input_json_delta" -> acc.json.append(delta.path("partial_json").asString(""));
                            default -> { }
                        }
                    }
                    case "content_block_stop" -> {
                        BlockAcc acc = byIndex.get(evt.path("index").asInt(-1));
                        if (acc != null) acc.finish(mapper);
                    }
                    case "message_delta" -> {
                        String sr = evt.path("delta").path("stop_reason").asString("");
                        if (!sr.isEmpty()) stop = mapAnthropicStop(sr);
                        int out = evt.path("usage").path("output_tokens").asInt(0);
                        if (out > 0) outputTokens = out;
                    }
                    default -> { /* message_stop, ping */ }
                }
            }
        }

        List<ContentBlock> blocks = new ArrayList<>();
        for (BlockAcc acc : byIndex.values()) {
            ContentBlock b = acc.finish(mapper);
            if (b != null) blocks.add(b);
        }
        return new TurnResult(stop, blocks, inputTokens, outputTokens, model);
    }

    private ArrayNode anthropicMessages(List<ChatMessage> messages) {
        ArrayNode arr = mapper.createArrayNode();
        for (ChatMessage m : messages) {
            ObjectNode mn = arr.addObject();
            mn.put("role", m.role() == ChatMessage.Role.USER ? "user" : "assistant");
            ArrayNode content = mn.putArray("content");
            for (ContentBlock b : m.blocks()) {
                switch (b) {
                    case ContentBlock.Text t -> {
                        // The API rejects empty text blocks, and a tool-only
                        // assistant turn legitimately has none.
                        if (t.text() == null || t.text().isEmpty()) continue;
                        ObjectNode n = content.addObject();
                        n.put("type", "text");
                        n.put("text", t.text());
                    }
                    case ContentBlock.ToolUse tu -> {
                        ObjectNode n = content.addObject();
                        n.put("type", "tool_use");
                        n.put("id", tu.id());
                        n.put("name", tu.name());
                        n.set("input", tu.input() == null ? mapper.createObjectNode() : tu.input());
                    }
                    case ContentBlock.ToolResult tr -> {
                        ObjectNode n = content.addObject();
                        n.put("type", "tool_result");
                        n.put("tool_use_id", tr.toolUseId());
                        n.put("content", tr.content() == null ? "" : tr.content());
                        if (tr.isError()) n.put("is_error", true);
                    }
                }
            }
        }
        return arr;
    }

    private static StopReason mapAnthropicStop(String s) {
        return switch (s) {
            case "end_turn", "stop_sequence" -> StopReason.END_TURN;
            case "tool_use" -> StopReason.TOOL_USE;
            case "max_tokens" -> StopReason.MAX_TOKENS;
            default -> StopReason.OTHER;
        };
    }

    // ------------------------------------------------------------------ OpenAI

    private TurnResult openAiTurn(
            LlmCredentialPayload.OpenAI p, LlmProvider provider, String model, String systemPrompt,
            List<ChatMessage> messages, List<ToolDef> tools, int maxTokens, TurnCallback cb
    ) throws Exception {
        ObjectNode body = mapper.createObjectNode();
        body.put("model", model);
        body.put("max_completion_tokens", maxTokens);
        body.put("stream", true);
        body.putObject("stream_options").put("include_usage", true);
        body.set("messages", openAiMessages(systemPrompt, messages));
        if (!tools.isEmpty()) {
            ArrayNode arr = body.putArray("tools");
            for (ToolDef t : tools) {
                ObjectNode tn = arr.addObject();
                tn.put("type", "function");
                ObjectNode fn = tn.putObject("function");
                fn.put("name", t.name());
                if (t.description() != null && !t.description().isBlank()) fn.put("description", t.description());
                fn.set("parameters", t.inputSchema() == null ? mapper.createObjectNode() : t.inputSchema());
            }
        }

        var req = HttpRequest.newBuilder()
                .uri(URI.create(endpoints.openAiChat(provider, p)))
                .header("Authorization", "Bearer " + p.apiKey())
                .header("content-type", "application/json")
                .header("accept", "text/event-stream")
                .timeout(REQUEST_TIMEOUT)
                .POST(HttpRequest.BodyPublishers.ofString(mapper.writeValueAsString(body)))
                .build();
        HttpResponse<InputStream> resp = httpClient.send(req, HttpResponse.BodyHandlers.ofInputStream());
        if (resp.statusCode() / 100 != 2) {
            String err = new String(resp.body().readAllBytes(), StandardCharsets.UTF_8);
            throw new IllegalStateException("OpenAI returned " + resp.statusCode() + ": " + abbreviate(err));
        }

        StringBuilder text = new StringBuilder();
        // One tool call is spread over many chunks; the index is the only
        // thing tying its fragments together.
        Map<Integer, BlockAcc> byIndex = new LinkedHashMap<>();
        int inputTokens = 0;
        int outputTokens = 0;
        StopReason stop = StopReason.END_TURN;

        try (var reader = new BufferedReader(new InputStreamReader(resp.body(), StandardCharsets.UTF_8))) {
            String data;
            while ((data = nextSseData(reader)) != null) {
                if ("[DONE]".equals(data)) break;
                JsonNode evt = mapper.readTree(data);
                JsonNode err = evt.path("error");
                if (err.isObject()) {
                    throw new IllegalStateException("OpenAI stream error: " + err.path("message").asString("unknown"));
                }
                JsonNode usageNode = evt.path("usage");
                if (usageNode.isObject()) {
                    inputTokens = usageNode.path("prompt_tokens").asInt(inputTokens);
                    outputTokens = usageNode.path("completion_tokens").asInt(outputTokens);
                }
                JsonNode choices = evt.path("choices");
                if (!choices.isArray() || choices.isEmpty()) continue;
                JsonNode choice = choices.get(0);
                JsonNode delta = choice.path("delta");
                String content = delta.path("content").asString("");
                if (!content.isEmpty()) {
                    text.append(content);
                    cb.onText(content);
                }
                JsonNode calls = delta.path("tool_calls");
                if (calls.isArray()) {
                    for (int i = 0; i < calls.size(); i++) {
                        JsonNode tc = calls.get(i);
                        int idx = tc.path("index").asInt(i);
                        BlockAcc acc = byIndex.computeIfAbsent(idx, k -> {
                            BlockAcc a = new BlockAcc();
                            a.toolUse = true;
                            return a;
                        });
                        String id = tc.path("id").asString("");
                        if (!id.isEmpty()) acc.id = id;
                        JsonNode fn = tc.path("function");
                        String name = fn.path("name").asString("");
                        if (!name.isEmpty()) acc.name = name;
                        acc.json.append(fn.path("arguments").asString(""));
                        if (!acc.announced && !acc.name.isEmpty()) {
                            acc.announced = true;
                            cb.onToolUseStart(acc.id, acc.name);
                        }
                    }
                }
                String finish = choice.path("finish_reason").asString("");
                if (!finish.isEmpty()) stop = mapOpenAiStop(finish);
            }
        }

        List<ContentBlock> blocks = new ArrayList<>();
        if (!text.isEmpty()) blocks.add(new ContentBlock.Text(text.toString()));
        for (BlockAcc acc : byIndex.values()) {
            ContentBlock b = acc.finish(mapper);
            if (b != null) blocks.add(b);
        }
        // Some compatible servers report "stop" even when they emitted tool
        // calls; the presence of calls is the more reliable signal.
        if (stop == StopReason.END_TURN && !byIndex.isEmpty()) stop = StopReason.TOOL_USE;
        return new TurnResult(stop, blocks, inputTokens, outputTokens, model);
    }

    private ArrayNode openAiMessages(String systemPrompt, List<ChatMessage> messages) {
        ArrayNode arr = mapper.createArrayNode();
        if (systemPrompt != null && !systemPrompt.isBlank()) {
            ObjectNode sys = arr.addObject();
            sys.put("role", "system");
            sys.put("content", systemPrompt);
        }
        for (ChatMessage m : messages) {
            if (m.role() == ChatMessage.Role.USER) {
                // Chat Completions wants each tool result as its own role=tool
                // message and user text as a separate user message.
                StringBuilder text = new StringBuilder();
                for (ContentBlock b : m.blocks()) {
                    switch (b) {
                        case ContentBlock.Text t -> text.append(t.text() == null ? "" : t.text());
                        case ContentBlock.ToolResult tr -> {
                            ObjectNode n = arr.addObject();
                            n.put("role", "tool");
                            n.put("tool_call_id", tr.toolUseId());
                            n.put("content", tr.content() == null ? "" : tr.content());
                        }
                        case ContentBlock.ToolUse ignored -> { /* not valid on the user side */ }
                    }
                }
                if (!text.isEmpty()) {
                    ObjectNode n = arr.addObject();
                    n.put("role", "user");
                    n.put("content", text.toString());
                }
            } else {
                ObjectNode n = arr.addObject();
                n.put("role", "assistant");
                StringBuilder text = new StringBuilder();
                ArrayNode calls = null;
                for (ContentBlock b : m.blocks()) {
                    switch (b) {
                        case ContentBlock.Text t -> text.append(t.text() == null ? "" : t.text());
                        case ContentBlock.ToolUse tu -> {
                            if (calls == null) calls = n.putArray("tool_calls");
                            ObjectNode c = calls.addObject();
                            c.put("id", tu.id());
                            c.put("type", "function");
                            ObjectNode fn = c.putObject("function");
                            fn.put("name", tu.name());
                            fn.put("arguments", tu.input() == null ? "{}" : mapper.writeValueAsString(tu.input()));
                        }
                        case ContentBlock.ToolResult ignored -> { /* not valid on the assistant side */ }
                    }
                }
                if (!text.isEmpty()) n.put("content", text.toString());
                else if (calls == null) n.put("content", "");
            }
        }
        return arr;
    }

    private static StopReason mapOpenAiStop(String s) {
        return switch (s) {
            case "stop" -> StopReason.END_TURN;
            case "tool_calls", "function_call" -> StopReason.TOOL_USE;
            case "length" -> StopReason.MAX_TOKENS;
            default -> StopReason.OTHER;
        };
    }

    // ------------------------------------------------------------------ shared

    /** One content block being assembled from stream fragments. */
    private static final class BlockAcc {
        boolean toolUse;
        String id = "";
        String name = "";
        boolean announced;
        final StringBuilder text = new StringBuilder();
        final StringBuilder json = new StringBuilder();
        ContentBlock done;

        /** Idempotent: content_block_stop and end-of-stream may both call it. */
        ContentBlock finish(ObjectMapper mapper) {
            if (done != null) return done;
            if (toolUse) {
                String raw = json.toString().trim();
                JsonNode input;
                if (raw.isEmpty()) {
                    input = mapper.createObjectNode();
                } else {
                    try {
                        input = mapper.readTree(raw);
                    } catch (Exception e) {
                        throw new IllegalStateException("tool input for '" + name + "' was not valid JSON: " + abbreviate(raw), e);
                    }
                    if (!input.isObject()) input = mapper.createObjectNode();
                }
                done = new ContentBlock.ToolUse(id, name, input);
            } else {
                if (text.isEmpty()) return null;
                done = new ContentBlock.Text(text.toString());
            }
            return done;
        }
    }

    /** Next non-empty SSE data payload, or null at end of stream. Tolerates "data:" with or without a space. */
    private static String nextSseData(BufferedReader reader) throws java.io.IOException {
        String line;
        while ((line = reader.readLine()) != null) {
            if (!line.startsWith("data:")) continue;
            String data = line.substring(5).trim();
            if (!data.isEmpty()) return data;
        }
        return null;
    }

    private static final TurnCallback NOOP = new TurnCallback() {
        @Override public void onText(String delta) { }
        @Override public void onToolUseStart(String id, String name) { }
    };

    private static String abbreviate(String s) {
        if (s == null) return "unknown error";
        String one = s.replaceAll("\\s+", " ").trim();
        return one.length() > 240 ? one.substring(0, 240) + "..." : one;
    }
}
