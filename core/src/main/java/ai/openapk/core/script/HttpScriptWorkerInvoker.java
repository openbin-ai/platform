package ai.openapk.core.script;

import ai.openapk.core.config.OpenApkProperties;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.boot.autoconfigure.condition.ConditionalOnExpression;
import org.springframework.stereotype.Component;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;

import java.io.IOException;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.util.Map;

/**
 * Self-hosted transport for the script workers: the Lambda container
 * images run as ordinary containers, where the Lambda Runtime Interface
 * Emulator baked into the AWS base image listens on port 8080 and accepts
 * {@code POST /2015-03-31/functions/function/invocations} with the event
 * as the body. The handler's return value comes back as the response
 * body; a handler exception comes back as a JSON object with
 * {@code errorType} and {@code errorMessage}, which this class turns into
 * the same {@link InvocationException} the Lambda path raises so callers
 * keep their error mapping.
 *
 * <p>Active when {@code openapk.script-analyzer.enabled=true} and
 * {@code openapk.script-analyzer.mode=http}. The per-ecosystem function
 * properties then hold base URLs instead of function names.
 */
@Component
@ConditionalOnExpression(
        "${openapk.script-analyzer.enabled:false} and '${openapk.script-analyzer.mode:lambda}' == 'http'")
public class HttpScriptWorkerInvoker implements ScriptWorkerInvoker {

    private static final Logger log = LoggerFactory.getLogger(HttpScriptWorkerInvoker.class);
    private static final String INVOKE_PATH = "/2015-03-31/functions/function/invocations";

    private final HttpClient http;
    private final ObjectMapper mapper;
    private final Duration timeout;

    public HttpScriptWorkerInvoker(OpenApkProperties props, ObjectMapper mapper) {
        var s = props.scriptAnalyzer();
        this.timeout = s.invokeTimeout() != null ? s.invokeTimeout() : Duration.ofSeconds(90);
        this.http = HttpClient.newBuilder()
                .connectTimeout(Duration.ofSeconds(10))
                .followRedirects(HttpClient.Redirect.NEVER)
                .build();
        this.mapper = mapper;
        log.info("script-worker HTTP invoker ready: npm={} pypi={} shell={} timeout={}",
                s.lambdaFunctionName(), s.pypiLambdaFunctionName(), s.shellLambdaFunctionName(), timeout);
    }

    @Override
    public byte[] invoke(String target, Map<String, Object> event) {
        if (target == null || target.isBlank()) {
            throw new InvocationException("script-worker URL is not configured");
        }
        byte[] payload;
        try {
            payload = mapper.writeValueAsBytes(event);
        } catch (Exception e) {
            throw new InvocationException("failed to serialize script-worker event", e);
        }
        URI uri = URI.create(target.replaceAll("/+$", "") + INVOKE_PATH);
        HttpRequest req = HttpRequest.newBuilder(uri)
                .timeout(timeout)
                .header("Content-Type", "application/json")
                .POST(HttpRequest.BodyPublishers.ofByteArray(payload))
                .build();

        HttpResponse<byte[]> resp;
        try {
            resp = http.send(req, HttpResponse.BodyHandlers.ofByteArray());
        } catch (IOException e) {
            throw new InvocationException("script-worker invoke failed for " + uri, e);
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            throw new InvocationException("script-worker invoke interrupted for " + uri, e);
        }

        byte[] body = resp.body() == null ? new byte[0] : resp.body();
        if (resp.statusCode() != 200) {
            throw new InvocationException("script-worker returned HTTP " + resp.statusCode()
                    + ": " + new String(body, StandardCharsets.UTF_8));
        }
        // The emulator answers 200 for handler exceptions too; the body is
        // then {"errorType": ..., "errorMessage": ...}. Mirror the Lambda
        // path, which surfaces these through FunctionError.
        String functionError = handlerError(body);
        if (functionError != null) {
            String bodyStr = new String(body, StandardCharsets.UTF_8);
            log.warn("script-worker handler error ({}): {}", functionError, bodyStr);
            throw new InvocationException("script-worker reported " + functionError + ": " + bodyStr);
        }
        return body;
    }

    private String handlerError(byte[] body) {
        if (body.length == 0 || body[0] != '{') return null;
        try {
            JsonNode node = mapper.readTree(body);
            if (node.has("errorType") || node.has("errorMessage")) {
                return node.path("errorType").asText("Unhandled");
            }
        } catch (Exception ignored) {
            // Not JSON, so not an error envelope.
        }
        return null;
    }
}
