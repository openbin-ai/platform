package ai.openapk.core.script;

import ai.openapk.core.config.OpenApkProperties;
import tools.jackson.databind.ObjectMapper;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.stereotype.Component;
import software.amazon.awssdk.auth.credentials.DefaultCredentialsProvider;
import software.amazon.awssdk.core.SdkBytes;
import software.amazon.awssdk.core.client.config.ClientOverrideConfiguration;
import software.amazon.awssdk.regions.Region;
import software.amazon.awssdk.services.lambda.LambdaClient;
import software.amazon.awssdk.services.lambda.model.InvokeRequest;
import software.amazon.awssdk.services.lambda.model.InvokeResponse;

import java.nio.charset.StandardCharsets;
import java.util.Map;

/**
 * Thin wrapper around the AWS Lambda invoke client for the script-worker
 * function. Two responsibilities:
 *
 * <ol>
 *   <li>Hold a singleton {@link LambdaClient} configured with the timeout
 *       from {@code openapk.script-analyzer.invoke-timeout}.</li>
 *   <li>Serialize the event, perform a synchronous invoke, and surface
 *       worker-side errors with enough detail for the caller to bail or
 *       retry. We expose the raw bytes of the response — deserialization
 *       lives in {@link ScriptAnalysisService} where the schema is known.</li>
 * </ol>
 *
 * Bean is only registered when {@code openapk.script-analyzer.enabled=true}
 * so dev profiles without AWS credentials boot cleanly.
 */
@Component
@ConditionalOnProperty(name = "openapk.script-analyzer.enabled", havingValue = "true")
public class LambdaInvoker {

    private static final Logger log = LoggerFactory.getLogger(LambdaInvoker.class);

    private final LambdaClient client;
    private final ObjectMapper mapper;
    private final String functionName;

    public LambdaInvoker(LambdaClient scriptWorkerLambdaClient,
                         ObjectMapper mapper,
                         OpenApkProperties props) {
        this.client = scriptWorkerLambdaClient;
        this.mapper = mapper;
        this.functionName = props.scriptAnalyzer().lambdaFunctionName();
    }

    /**
     * Synchronously invoke the script-worker. Returns the raw JSON bytes
     * the function returned — callers deserialize into their target type.
     *
     * @throws LambdaInvocationException on any worker-side or transport
     *         failure; the original exception is the cause when available.
     */
    public byte[] invoke(Map<String, Object> event) {
        byte[] payload;
        try {
            payload = mapper.writeValueAsBytes(event);
        } catch (Exception e) {
            throw new LambdaInvocationException(
                    "failed to serialize script-worker event", e);
        }

        InvokeRequest req = InvokeRequest.builder()
                .functionName(functionName)
                .payload(SdkBytes.fromByteArray(payload))
                .build();

        InvokeResponse resp;
        try {
            resp = client.invoke(req);
        } catch (RuntimeException e) {
            throw new LambdaInvocationException(
                    "script-worker invoke failed for " + functionName, e);
        }

        // The Lambda Invoke API surfaces handler errors via FunctionError
        // plus an errorMessage in the payload. Status code 200 on its own
        // is NOT a success signal — check FunctionError first.
        String functionError = resp.functionError();
        byte[] body = resp.payload().asByteArray();
        if (functionError != null) {
            String bodyStr = new String(body, StandardCharsets.UTF_8);
            log.warn("script-worker handler error ({}): {}", functionError, bodyStr);
            throw new LambdaInvocationException(
                    "script-worker reported " + functionError + ": " + bodyStr);
        }
        if (resp.statusCode() != 200) {
            throw new LambdaInvocationException(
                    "script-worker returned HTTP " + resp.statusCode());
        }
        return body;
    }

    /**
     * Wire up the AWS SDK Lambda client. Reuses the same BOM as the
     * other AWS clients (sesv2, s3, cloudfront). Default credential
     * chain — ECS task role in prod, local AWS profile in dev.
     */
    @Configuration
    @ConditionalOnProperty(name = "openapk.script-analyzer.enabled", havingValue = "true")
    static class Config {
        @Bean(destroyMethod = "close")
        LambdaClient scriptWorkerLambdaClient(OpenApkProperties props) {
            var s = props.scriptAnalyzer();
            var override = ClientOverrideConfiguration.builder()
                    .apiCallTimeout(s.invokeTimeout())
                    .apiCallAttemptTimeout(s.invokeTimeout())
                    .build();
            LambdaClient client = LambdaClient.builder()
                    .region(Region.of(s.region()))
                    .credentialsProvider(DefaultCredentialsProvider.create())
                    .overrideConfiguration(override)
                    .build();
            log.info("script-worker Lambda client ready: function={} region={} timeout={}",
                    s.lambdaFunctionName(), s.region(), s.invokeTimeout());
            return client;
        }
    }

    /** Thrown when the invoke transport or the worker itself failed. */
    public static class LambdaInvocationException extends RuntimeException {
        public LambdaInvocationException(String message) { super(message); }
        public LambdaInvocationException(String message, Throwable cause) { super(message, cause); }
    }
}
