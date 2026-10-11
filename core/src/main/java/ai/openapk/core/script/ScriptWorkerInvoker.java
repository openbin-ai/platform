package ai.openapk.core.script;

import java.util.Map;

/**
 * Transport to the script analyzers (npm / pypi / shell workers). The
 * workers are built as AWS Lambda container images; in the hosted product
 * they run on Lambda and are reached through {@link LambdaInvoker}. A
 * self-hosted install runs the same images as plain containers under the
 * Lambda Runtime Interface Emulator and reaches them over HTTP through
 * {@link HttpScriptWorkerInvoker}. {@code openapk.script-analyzer.mode}
 * picks the implementation ({@code lambda}, the default, or {@code http}).
 *
 * <p>{@code target} is whatever the per-ecosystem function property holds:
 * a Lambda function name or ARN in lambda mode, a base URL such as
 * {@code http://script-worker:8080} in http mode. The event and the
 * response bytes are identical either way, so {@link ScriptAnalysisService}
 * never knows which transport it is on.
 */
public interface ScriptWorkerInvoker {

    byte[] invoke(String target, Map<String, Object> event);

    /** Thrown when the transport or the worker itself failed. */
    class InvocationException extends RuntimeException {
        public InvocationException(String message) { super(message); }
        public InvocationException(String message, Throwable cause) { super(message, cause); }
    }
}
