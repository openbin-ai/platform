package ai.openapk.core.analysis.agent;

import ai.openapk.core.analysis.LlmInvoker;
import ai.openapk.core.auth.User;
import ai.openapk.core.credentials.LlmCredential;
import ai.openapk.core.credentials.LlmCredentialPayload;
import ai.openapk.core.credentials.LlmProvider;
import ai.openapk.core.usage.LlmUsageService;
import com.sun.net.httpserver.HttpServer;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.web.server.ResponseStatusException;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;

import java.net.InetSocketAddress;
import java.net.http.HttpClient;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;
import java.util.concurrent.atomic.AtomicReference;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertInstanceOf;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * Drives both wire paths against a loopback HTTP server that replays canned
 * SSE bodies and captures the request. No network, no Spring context. The
 * production URL builders refuse loopback (egress policy), so the invoker is
 * built with an {@link ToolLlmInvoker.Endpoints} pointing at the server.
 */
class ToolLlmInvokerTest {

    private final ObjectMapper mapper = new ObjectMapper();

    private HttpServer server;
    private String baseUrl;
    private final AtomicReference<String> cannedBody = new AtomicReference<>("");
    private final AtomicReference<JsonNode> capturedRequest = new AtomicReference<>();
    private final AtomicReference<String> capturedPath = new AtomicReference<>();

    private final List<String> recorded = new ArrayList<>();
    private ToolLlmInvoker invoker;
    private User user;

    @BeforeEach
    void start() throws Exception {
        server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        server.createContext("/", ex -> {
            capturedPath.set(ex.getRequestURI().getPath());
            capturedRequest.set(mapper.readTree(ex.getRequestBody().readAllBytes()));
            byte[] out = cannedBody.get().getBytes(StandardCharsets.UTF_8);
            ex.getResponseHeaders().add("Content-Type", "text/event-stream");
            ex.sendResponseHeaders(200, out.length);
            ex.getResponseBody().write(out);
            ex.close();
        });
        server.start();
        baseUrl = "http://127.0.0.1:" + server.getAddress().getPort();

        user = new User();
        user.setId(UUID.randomUUID());

        ToolLlmInvoker.Endpoints endpoints = new ToolLlmInvoker.Endpoints() {
            @Override public String anthropicMessages(LlmCredentialPayload.Anthropic p) { return baseUrl + "/v1/messages"; }
            @Override public String openAiChat(LlmProvider provider, LlmCredentialPayload.OpenAI p) { return baseUrl + "/v1/chat/completions"; }
        };
        invoker = new ToolLlmInvoker(new FakeLlmInvoker(), mapper, new FakeUsage(),
                HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(5)).build(), endpoints);
    }

    @AfterEach
    void stop() {
        server.stop(0);
    }

    // ---------------------------------------------------------------- fakes

    /** Returns a fixed payload per provider and passes the model through; no crypto, no catalog. */
    private static final class FakeLlmInvoker extends LlmInvoker {
        FakeLlmInvoker() { super(null, null, new ObjectMapper(), null, null); }
        @Override public LlmCredentialPayload decodePayload(LlmCredential c) {
            return switch (c.getProvider().kind()) {
                case ANTHROPIC -> new LlmCredentialPayload.Anthropic("sk-ant-test", null);
                case OPENAI -> new LlmCredentialPayload.OpenAI("sk-test", null);
                case BEDROCK -> new LlmCredentialPayload.Bedrock("a", "b", null, "us-east-1");
            };
        }
        @Override public String resolveModel(LlmCredential cred, String requested) {
            return requested == null || requested.isBlank() ? "test-model" : requested;
        }
    }

    private final class FakeUsage extends LlmUsageService {
        FakeUsage() { super(null, null); }
        @Override public void checkBudget(User u) { recorded.add("checkBudget"); }
        @Override public void record(User u, UUID projectId, String provider, String model, String purpose,
                                     int in, int out, boolean success, String err) {
            recorded.add("record:" + provider + ":" + model + ":" + in + ":" + out + ":" + success);
        }
    }

    private static LlmCredential cred(LlmProvider p) {
        var c = new LlmCredential();
        c.setProvider(p);
        return c;
    }

    private static final class CapturingCallback implements TurnCallback {
        final StringBuilder text = new StringBuilder();
        final List<String> toolStarts = new ArrayList<>();
        @Override public void onText(String delta) { text.append(delta); }
        @Override public void onToolUseStart(String id, String name) { toolStarts.add(id + "/" + name); }
    }

    private static String sse(String... events) {
        StringBuilder sb = new StringBuilder();
        for (String e : events) sb.append("data: ").append(e).append("\n\n");
        return sb.toString();
    }

    private ToolDef lookupTool() {
        JsonNode schema = mapper.readTree("{\"type\":\"object\",\"properties\":{\"name\":{\"type\":\"string\"}},\"required\":[\"name\"]}");
        return new ToolDef("lookup_function", "Find a function by name", schema);
    }

    // ------------------------------------------------------------- Anthropic

    @Test
    void anthropicTextOnlyTurnStreamsTextAndEndsTurn() {
        cannedBody.set(sse(
                "{\"type\":\"message_start\",\"message\":{\"usage\":{\"input_tokens\":42,\"output_tokens\":1}}}",
                "{\"type\":\"content_block_start\",\"index\":0,\"content_block\":{\"type\":\"text\",\"text\":\"\"}}",
                "{\"type\":\"ping\"}",
                "{\"type\":\"content_block_delta\",\"index\":0,\"delta\":{\"type\":\"text_delta\",\"text\":\"Hello\"}}",
                "{\"type\":\"content_block_delta\",\"index\":0,\"delta\":{\"type\":\"text_delta\",\"text\":\", world\"}}",
                "{\"type\":\"content_block_stop\",\"index\":0}",
                "{\"type\":\"message_delta\",\"delta\":{\"stop_reason\":\"end_turn\"},\"usage\":{\"output_tokens\":7}}",
                "{\"type\":\"message_stop\"}"
        ));
        var cb = new CapturingCallback();

        TurnResult r = invoker.streamTurn(user, UUID.randomUUID(), "agent", cred(LlmProvider.ANTHROPIC),
                "You are a reverse engineer.", List.of(ChatMessage.user("hi")), List.of(), 1024, "claude-x", cb);

        assertEquals("Hello, world", cb.text.toString());
        assertEquals(StopReason.END_TURN, r.stopReason());
        assertEquals(1, r.blocks().size());
        assertEquals("Hello, world", r.text());
        assertEquals(42, r.inputTokens());
        assertEquals(7, r.outputTokens());
        assertEquals("claude-x", r.model());
        assertTrue(cb.toolStarts.isEmpty());
        assertEquals(List.of("checkBudget", "record:ANTHROPIC:claude-x:42:7:true"), recorded);

        JsonNode req = capturedRequest.get();
        assertEquals("/v1/messages", capturedPath.get());
        assertEquals("claude-x", req.path("model").asString());
        assertTrue(req.path("stream").asBoolean());
        assertEquals(1024, req.path("max_tokens").asInt());
        assertEquals("ephemeral", req.path("system").get(0).path("cache_control").path("type").asString());
        assertEquals("You are a reverse engineer.", req.path("system").get(0).path("text").asString());
        assertTrue(req.path("tools").isMissingNode(), "no tools key when no tools are given");
        assertEquals("hi", req.path("messages").get(0).path("content").get(0).path("text").asString());
    }

    @Test
    void anthropicToolTurnYieldsParsedToolUse() {
        cannedBody.set(sse(
                "{\"type\":\"message_start\",\"message\":{\"usage\":{\"input_tokens\":100}}}",
                "{\"type\":\"content_block_start\",\"index\":0,\"content_block\":{\"type\":\"text\",\"text\":\"\"}}",
                "{\"type\":\"content_block_delta\",\"index\":0,\"delta\":{\"type\":\"text_delta\",\"text\":\"Looking it up.\"}}",
                "{\"type\":\"content_block_stop\",\"index\":0}",
                "{\"type\":\"content_block_start\",\"index\":1,\"content_block\":{\"type\":\"tool_use\",\"id\":\"toolu_01\",\"name\":\"lookup_function\",\"input\":{}}}",
                "{\"type\":\"content_block_delta\",\"index\":1,\"delta\":{\"type\":\"input_json_delta\",\"partial_json\":\"\"}}",
                "{\"type\":\"content_block_delta\",\"index\":1,\"delta\":{\"type\":\"input_json_delta\",\"partial_json\":\"{\\\"na\"}}",
                "{\"type\":\"content_block_delta\",\"index\":1,\"delta\":{\"type\":\"input_json_delta\",\"partial_json\":\"me\\\": \\\"main\\\"}\"}}",
                "{\"type\":\"content_block_stop\",\"index\":1}",
                "{\"type\":\"message_delta\",\"delta\":{\"stop_reason\":\"tool_use\"},\"usage\":{\"output_tokens\":23}}",
                "{\"type\":\"message_stop\"}"
        ));
        var cb = new CapturingCallback();

        TurnResult r = invoker.streamTurn(user, null, "agent", cred(LlmProvider.ANTHROPIC),
                "sys", List.of(ChatMessage.user("what does main do")), List.of(lookupTool()), 512, null, cb);

        assertEquals(StopReason.TOOL_USE, r.stopReason());
        assertEquals("Looking it up.", cb.text.toString());
        assertEquals(List.of("toolu_01/lookup_function"), cb.toolStarts);
        assertEquals(2, r.blocks().size());
        assertInstanceOf(ContentBlock.Text.class, r.blocks().get(0));
        var tu = assertInstanceOf(ContentBlock.ToolUse.class, r.blocks().get(1));
        assertEquals("toolu_01", tu.id());
        assertEquals("lookup_function", tu.name());
        assertEquals("main", tu.input().path("name").asString());
        assertEquals(1, r.toolUses().size());
        assertEquals(100, r.inputTokens());
        assertEquals(23, r.outputTokens());
        assertEquals("test-model", r.model());

        JsonNode tools = capturedRequest.get().path("tools");
        assertEquals(1, tools.size());
        assertEquals("lookup_function", tools.get(0).path("name").asString());
        assertEquals("Find a function by name", tools.get(0).path("description").asString());
        assertEquals("object", tools.get(0).path("input_schema").path("type").asString());
    }

    @Test
    void anthropicSecondRequestCarriesToolUseAndToolResult() {
        cannedBody.set(sse(
                "{\"type\":\"message_start\",\"message\":{\"usage\":{\"input_tokens\":5}}}",
                "{\"type\":\"content_block_start\",\"index\":0,\"content_block\":{\"type\":\"text\",\"text\":\"\"}}",
                "{\"type\":\"content_block_delta\",\"index\":0,\"delta\":{\"type\":\"text_delta\",\"text\":\"done\"}}",
                "{\"type\":\"content_block_stop\",\"index\":0}",
                "{\"type\":\"message_delta\",\"delta\":{\"stop_reason\":\"end_turn\"},\"usage\":{\"output_tokens\":1}}"
        ));
        JsonNode input = mapper.readTree("{\"name\":\"main\"}");
        List<ChatMessage> history = List.of(
                ChatMessage.user("what does main do"),
                ChatMessage.assistant(List.of(
                        new ContentBlock.Text("Looking it up."),
                        new ContentBlock.ToolUse("toolu_01", "lookup_function", input))),
                ChatMessage.toolResults(List.of(
                        new ContentBlock.ToolResult("toolu_01", "int main() { return 0; }", false)))
        );

        TurnResult r = invoker.streamTurn(user, null, "agent", cred(LlmProvider.ANTHROPIC),
                "sys", history, List.of(lookupTool()), 512, null, null);
        assertEquals("done", r.text());

        JsonNode msgs = capturedRequest.get().path("messages");
        assertEquals(3, msgs.size());

        JsonNode asst = msgs.get(1);
        assertEquals("assistant", asst.path("role").asString());
        assertEquals(2, asst.path("content").size());
        assertEquals("text", asst.path("content").get(0).path("type").asString());
        assertEquals("Looking it up.", asst.path("content").get(0).path("text").asString());
        JsonNode tu = asst.path("content").get(1);
        assertEquals("tool_use", tu.path("type").asString());
        assertEquals("toolu_01", tu.path("id").asString());
        assertEquals("lookup_function", tu.path("name").asString());
        assertEquals("main", tu.path("input").path("name").asString());

        JsonNode res = msgs.get(2);
        assertEquals("user", res.path("role").asString());
        JsonNode tr = res.path("content").get(0);
        assertEquals("tool_result", tr.path("type").asString());
        assertEquals("toolu_01", tr.path("tool_use_id").asString());
        assertEquals("int main() { return 0; }", tr.path("content").asString());
        assertTrue(tr.path("is_error").isMissingNode(), "is_error omitted when false");
    }

    @Test
    void anthropicStreamErrorEventFailsTheTurnAndRecordsFailure() {
        cannedBody.set(sse(
                "{\"type\":\"message_start\",\"message\":{\"usage\":{\"input_tokens\":5}}}",
                "{\"type\":\"error\",\"error\":{\"type\":\"overloaded_error\",\"message\":\"Overloaded\"}}"
        ));
        var e = assertThrows(ResponseStatusException.class, () -> invoker.streamTurn(user, null, "agent",
                cred(LlmProvider.ANTHROPIC), "sys", List.of(ChatMessage.user("hi")), List.of(), 10, "m", null));
        assertEquals(502, e.getStatusCode().value());
        assertTrue(e.getReason().contains("Overloaded"));
        assertEquals(List.of("checkBudget", "record:ANTHROPIC:m:0:0:false"), recorded);
    }

    // ---------------------------------------------------------------- OpenAI

    @Test
    void openAiTextOnlyTurnStreamsTextAndEndsTurn() {
        cannedBody.set(sse(
                "{\"id\":\"c1\",\"choices\":[{\"index\":0,\"delta\":{\"role\":\"assistant\",\"content\":\"\"},\"finish_reason\":null}]}",
                "{\"id\":\"c1\",\"choices\":[{\"index\":0,\"delta\":{\"content\":\"Hello\"},\"finish_reason\":null}]}",
                "{\"id\":\"c1\",\"choices\":[{\"index\":0,\"delta\":{\"content\":\", world\"},\"finish_reason\":null}]}",
                "{\"id\":\"c1\",\"choices\":[{\"index\":0,\"delta\":{},\"finish_reason\":\"stop\"}]}",
                "{\"id\":\"c1\",\"choices\":[],\"usage\":{\"prompt_tokens\":31,\"completion_tokens\":6}}",
                "[DONE]"
        ));
        var cb = new CapturingCallback();

        TurnResult r = invoker.streamTurn(user, UUID.randomUUID(), "agent", cred(LlmProvider.DEEPSEEK),
                "You are a reverse engineer.", List.of(ChatMessage.user("hi")), List.of(), 256, "deepseek-chat", cb);

        assertEquals("Hello, world", cb.text.toString());
        assertEquals(StopReason.END_TURN, r.stopReason());
        assertEquals("Hello, world", r.text());
        assertEquals(31, r.inputTokens());
        assertEquals(6, r.outputTokens());
        assertEquals(List.of("checkBudget", "record:DEEPSEEK:deepseek-chat:31:6:true"), recorded);

        JsonNode req = capturedRequest.get();
        assertEquals("/v1/chat/completions", capturedPath.get());
        assertTrue(req.path("stream").asBoolean());
        assertTrue(req.path("stream_options").path("include_usage").asBoolean());
        assertEquals(256, req.path("max_completion_tokens").asInt());
        assertTrue(req.path("tools").isMissingNode());
        assertEquals("system", req.path("messages").get(0).path("role").asString());
        assertEquals("You are a reverse engineer.", req.path("messages").get(0).path("content").asString());
        assertEquals("user", req.path("messages").get(1).path("role").asString());
        assertEquals("hi", req.path("messages").get(1).path("content").asString());
    }

    @Test
    void openAiToolCallFragmentsAreAccumulatedByIndex() {
        cannedBody.set(sse(
                "{\"choices\":[{\"index\":0,\"delta\":{\"role\":\"assistant\",\"content\":null},\"finish_reason\":null}]}",
                "{\"choices\":[{\"index\":0,\"delta\":{\"content\":\"Let me check. \"},\"finish_reason\":null}]}",
                "{\"choices\":[{\"index\":0,\"delta\":{\"tool_calls\":[{\"index\":0,\"id\":\"call_abc\",\"type\":\"function\",\"function\":{\"name\":\"lookup_function\",\"arguments\":\"\"}}]},\"finish_reason\":null}]}",
                "{\"choices\":[{\"index\":0,\"delta\":{\"tool_calls\":[{\"index\":0,\"function\":{\"arguments\":\"{\\\"na\"}}]},\"finish_reason\":null}]}",
                "{\"choices\":[{\"index\":0,\"delta\":{\"tool_calls\":[{\"index\":1,\"id\":\"call_def\",\"type\":\"function\",\"function\":{\"name\":\"lookup_function\",\"arguments\":\"\"}}]},\"finish_reason\":null}]}",
                "{\"choices\":[{\"index\":0,\"delta\":{\"tool_calls\":[{\"index\":0,\"function\":{\"arguments\":\"me\\\":\\\"main\\\"}\"}}]},\"finish_reason\":null}]}",
                "{\"choices\":[{\"index\":0,\"delta\":{\"tool_calls\":[{\"index\":1,\"function\":{\"arguments\":\"{\\\"name\\\":\\\"init\\\"}\"}}]},\"finish_reason\":null}]}",
                "{\"choices\":[{\"index\":0,\"delta\":{},\"finish_reason\":\"tool_calls\"}]}",
                "{\"choices\":[],\"usage\":{\"prompt_tokens\":80,\"completion_tokens\":40}}",
                "[DONE]"
        ));
        var cb = new CapturingCallback();

        TurnResult r = invoker.streamTurn(user, null, "agent", cred(LlmProvider.OPENAI),
                "sys", List.of(ChatMessage.user("what do main and init do")), List.of(lookupTool()), 512, "gpt-x", cb);

        assertEquals(StopReason.TOOL_USE, r.stopReason());
        assertEquals("Let me check. ", cb.text.toString());
        assertEquals(List.of("call_abc/lookup_function", "call_def/lookup_function"), cb.toolStarts);
        assertEquals(3, r.blocks().size());
        assertEquals("Let me check. ", r.text());
        List<ContentBlock.ToolUse> uses = r.toolUses();
        assertEquals(2, uses.size());
        assertEquals("call_abc", uses.get(0).id());
        assertEquals("main", uses.get(0).input().path("name").asString());
        assertEquals("call_def", uses.get(1).id());
        assertEquals("init", uses.get(1).input().path("name").asString());
        assertEquals(80, r.inputTokens());
        assertEquals(40, r.outputTokens());

        JsonNode tools = capturedRequest.get().path("tools");
        assertEquals(1, tools.size());
        assertEquals("function", tools.get(0).path("type").asString());
        assertEquals("lookup_function", tools.get(0).path("function").path("name").asString());
        assertEquals("object", tools.get(0).path("function").path("parameters").path("type").asString());
    }

    @Test
    void openAiSecondRequestCarriesToolCallsAndToolReply() {
        cannedBody.set(sse(
                "{\"choices\":[{\"index\":0,\"delta\":{\"content\":\"done\"},\"finish_reason\":null}]}",
                "{\"choices\":[{\"index\":0,\"delta\":{},\"finish_reason\":\"stop\"}]}",
                "[DONE]"
        ));
        JsonNode input = mapper.readTree("{\"name\":\"main\"}");
        List<ChatMessage> history = List.of(
                ChatMessage.user("what does main do"),
                ChatMessage.assistant(List.of(new ContentBlock.ToolUse("call_abc", "lookup_function", input))),
                ChatMessage.toolResults(List.of(new ContentBlock.ToolResult("call_abc", "int main() { return 0; }", false)))
        );

        TurnResult r = invoker.streamTurn(user, null, "agent", cred(LlmProvider.OPENAI),
                "sys", history, List.of(lookupTool()), 512, "gpt-x", null);
        assertEquals("done", r.text());
        assertEquals(StopReason.END_TURN, r.stopReason());

        JsonNode msgs = capturedRequest.get().path("messages");
        assertEquals(4, msgs.size(), "system, user, assistant, tool");
        assertEquals("system", msgs.get(0).path("role").asString());
        assertEquals("user", msgs.get(1).path("role").asString());

        JsonNode asst = msgs.get(2);
        assertEquals("assistant", asst.path("role").asString());
        assertTrue(asst.path("content").isMissingNode(), "tool-only assistant turn carries no content field");
        JsonNode call = asst.path("tool_calls").get(0);
        assertEquals("call_abc", call.path("id").asString());
        assertEquals("function", call.path("type").asString());
        assertEquals("lookup_function", call.path("function").path("name").asString());
        // arguments is a JSON string on this wire, not an object
        assertTrue(call.path("function").path("arguments").isString());
        assertEquals("main", mapper.readTree(call.path("function").path("arguments").asString()).path("name").asString());

        JsonNode tool = msgs.get(3);
        assertEquals("tool", tool.path("role").asString());
        assertEquals("call_abc", tool.path("tool_call_id").asString());
        assertEquals("int main() { return 0; }", tool.path("content").asString());
    }

    // --------------------------------------------------------------- Bedrock

    @Test
    void bedrockIsRefusedBeforeAnyBudgetOrAuditWork() {
        assertThrows(UnsupportedOperationException.class, () -> invoker.streamTurn(user, null, "agent",
                cred(LlmProvider.BEDROCK), "sys", List.of(ChatMessage.user("hi")), List.of(), 10, null, null));
        assertTrue(recorded.isEmpty());
        assertNull(capturedRequest.get(), "no request must leave the box");
    }
}
