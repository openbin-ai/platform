package ai.openapk.core.projects;

import ai.openapk.core.config.OpenApkProperties;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Component;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Duration;

/**
 * Thin HTTP client for the Python FastAPI JADX worker. The worker exposes:
 *
 * <pre>{@code
 * POST /decompile  multipart/form-data {apk: <file>}  -> 200 application/gzip (tar.gz of decompile tree)
 * GET  /health                                        -> 200
 * }</pre>
 *
 * <p>Synchronous. Callers are expected to wrap this in an {@link
 * org.springframework.scheduling.annotation.Async} executor so the HTTP
 * request thread isn't held for minutes while a large APK decompiles.
 *
 * <p>Unlike the sibling {@link ai.openapk.core.nativeanalysis.GhidraWorkerClient}
 * — whose response is a small JSON blob — this worker's response can be hundreds
 * of MB of decompiled source. We therefore return an {@link InputStream} body
 * so the caller can pipe it straight into {@code tar} extraction without
 * buffering the whole tree in heap.
 */
@Component
public class JadxWorkerClient {

    private static final Logger log = LoggerFactory.getLogger(JadxWorkerClient.class);

    private final HttpClient http;
    private final URI decompileUri;
    private final Duration requestTimeout;
    private final String workerToken;

    public JadxWorkerClient(OpenApkProperties props) {
        String base = props.jadx() != null && props.jadx().workerUrl() != null
                ? props.jadx().workerUrl()
                : "http://localhost:8001";
        Duration timeout = props.jadx() != null && props.jadx().workerTimeout() != null
                ? props.jadx().workerTimeout()
                : Duration.ofMinutes(20);
        String token = props.jadx() != null ? props.jadx().workerToken() : null;
        this.workerToken = token != null && !token.isBlank() ? token : null;
        this.decompileUri = URI.create(stripTrailingSlash(base) + "/decompile");
        this.requestTimeout = timeout;
        this.http = HttpClient.newBuilder()
                .connectTimeout(Duration.ofSeconds(30))
                .version(HttpClient.Version.HTTP_1_1)
                .build();
    }

    /**
     * Result of a worker call. {@code status} is the HTTP status code. On
     * success {@code body} is the tar.gz stream; on failure {@code body}
     * is the JSON error blob (still streamable, but small). Callers are
     * responsible for closing {@code body}.
     */
    public record WorkerResponse(int status, InputStream body) implements AutoCloseable {
        public boolean isOk() { return status >= 200 && status < 300; }
        @Override
        public void close() throws IOException {
            if (body != null) body.close();
        }
    }

    /**
     * Upload an APK to the worker. Streams the response body back without
     * buffering. Caller must close the returned {@code WorkerResponse}.
     *
     * <p>Upload itself is buffered (the APK is read into memory to build the
     * multipart body). Typical APKs are tens of MB so this is fine; if we
     * ever need to handle multi-GB uploads we can switch to a streaming
     * BodyPublisher that constructs the multipart on the fly.
     */
    public WorkerResponse decompile(Path apk, String filename) throws IOException, InterruptedException {
        if (!Files.isRegularFile(apk)) {
            throw new IOException("not a regular file: " + apk);
        }
        byte[] bytes = Files.readAllBytes(apk);
        String boundary = "----openapk" + Long.toHexString(System.nanoTime());
        byte[] body = buildMultipartBody(boundary, filename, bytes);

        var builder = HttpRequest.newBuilder(decompileUri)
                .timeout(requestTimeout)
                .header("Content-Type", "multipart/form-data; boundary=" + boundary)
                .header("Accept", "application/gzip, application/json")
                .POST(HttpRequest.BodyPublishers.ofByteArray(body));
        if (workerToken != null) {
            builder.header("X-Worker-Token", workerToken);
        }
        var req = builder.build();

        log.info("Calling jadx-worker /decompile: file={} size={}b uri={}",
                filename, bytes.length, decompileUri);
        long start = System.currentTimeMillis();
        HttpResponse<InputStream> resp = http.send(req, HttpResponse.BodyHandlers.ofInputStream());
        long ms = System.currentTimeMillis() - start;
        log.info("jadx-worker /decompile responded status={} after {}ms (body streaming)",
                resp.statusCode(), ms);

        return new WorkerResponse(resp.statusCode(), resp.body());
    }

    private static byte[] buildMultipartBody(String boundary, String filename, byte[] file) throws IOException {
        var out = new ByteArrayOutputStream();
        writeAscii(out, "--" + boundary + "\r\n");
        writeAscii(out, "Content-Disposition: form-data; name=\"apk\"; filename=\""
                + escapeQuotes(filename) + "\"\r\n");
        writeAscii(out, "Content-Type: application/octet-stream\r\n\r\n");
        out.write(file);
        writeAscii(out, "\r\n");
        writeAscii(out, "--" + boundary + "--\r\n");
        return out.toByteArray();
    }

    private static void writeAscii(ByteArrayOutputStream out, String s) throws IOException {
        out.write(s.getBytes(StandardCharsets.US_ASCII));
    }

    private static String escapeQuotes(String s) {
        return s.replace("\"", "");
    }

    private static String stripTrailingSlash(String s) {
        return s.endsWith("/") ? s.substring(0, s.length() - 1) : s;
    }
}
