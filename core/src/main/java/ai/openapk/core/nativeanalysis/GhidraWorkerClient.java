package ai.openapk.core.nativeanalysis;

import ai.openapk.core.config.OpenApkProperties;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Component;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Duration;

/**
 * Thin HTTP client for the Python FastAPI Ghidra worker. The worker exposes:
 *
 * <pre>{@code
 * POST /analyze   multipart/form-data {binary: <file>, arch: <string>}  -> 200 application/json (extract)
 * GET  /health                                                          -> 200
 * }</pre>
 *
 * Synchronous. Callers are expected to wrap this in an {@link org.springframework.scheduling.annotation.Async}
 * executor so the HTTP request thread isn't held for minutes.
 */
@Component
public class GhidraWorkerClient {

    private static final Logger log = LoggerFactory.getLogger(GhidraWorkerClient.class);

    private final HttpClient http;
    private final URI analyzeUri;
    private final Duration requestTimeout;

    public GhidraWorkerClient(OpenApkProperties props) {
        String base = props.ghidra() != null && props.ghidra().workerUrl() != null
                ? props.ghidra().workerUrl()
                : "http://localhost:8000";
        Duration timeout = props.ghidra() != null && props.ghidra().workerTimeout() != null
                ? props.ghidra().workerTimeout()
                : Duration.ofMinutes(15);
        this.analyzeUri = URI.create(stripTrailingSlash(base) + "/analyze");
        this.requestTimeout = timeout;
        this.http = HttpClient.newBuilder()
                .connectTimeout(Duration.ofSeconds(30))
                .version(HttpClient.Version.HTTP_1_1)
                .build();
    }

    /** Result of a worker call. {@code body} is the raw JSON the worker produced. */
    public record WorkerResponse(int status, String body) {
        public boolean isOk() { return status >= 200 && status < 300; }
    }

    /**
     * Upload a single .so file to the worker and return its extracted JSON.
     * Reads the file fully into memory — sufficient for typical APK natives
     * (single-digit MB); if we ever ship a streaming worker contract we can
     * switch this to chunked transfer-encoding.
     */
    public WorkerResponse analyze(Path binary, String filename, String arch) throws IOException, InterruptedException {
        if (!Files.isRegularFile(binary)) {
            throw new IOException("not a regular file: " + binary);
        }
        byte[] bytes = Files.readAllBytes(binary);
        String boundary = "----openapk" + Long.toHexString(System.nanoTime());
        byte[] body = buildMultipartBody(boundary, filename, arch, bytes);

        var req = HttpRequest.newBuilder(analyzeUri)
                .timeout(requestTimeout)
                .header("Content-Type", "multipart/form-data; boundary=" + boundary)
                .header("Accept", "application/json")
                .POST(HttpRequest.BodyPublishers.ofByteArray(body))
                .build();

        log.info("Calling ghidra-worker /analyze: file={} arch={} size={}b uri={}",
                filename, arch, bytes.length, analyzeUri);
        long start = System.currentTimeMillis();
        HttpResponse<String> resp = http.send(req, HttpResponse.BodyHandlers.ofString(StandardCharsets.UTF_8));
        long ms = System.currentTimeMillis() - start;
        log.info("ghidra-worker /analyze responded status={} in {}ms", resp.statusCode(), ms);

        return new WorkerResponse(resp.statusCode(), resp.body());
    }

    private static byte[] buildMultipartBody(String boundary, String filename, String arch, byte[] file) throws IOException {
        var out = new ByteArrayOutputStream();
        writeAscii(out, "--" + boundary + "\r\n");
        writeAscii(out, "Content-Disposition: form-data; name=\"arch\"\r\n\r\n");
        writeAscii(out, arch + "\r\n");

        writeAscii(out, "--" + boundary + "\r\n");
        writeAscii(out, "Content-Disposition: form-data; name=\"binary\"; filename=\""
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
