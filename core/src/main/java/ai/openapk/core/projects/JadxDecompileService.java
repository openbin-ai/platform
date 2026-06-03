package ai.openapk.core.projects;

import ai.openapk.core.projects.storage.ProjectStorage;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;
import org.w3c.dom.Document;

import javax.xml.parsers.DocumentBuilderFactory;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.UUID;
import java.util.function.Consumer;

/**
 * Decompiles an APK by delegating to the JADX worker microservice. Replaces
 * the previous in-JVM JADX integration so a hostile or oversized APK can't
 * OOM the backend — the worker container is the trust boundary, with
 * prlimit + a wall-clock timeout enforced per request.
 *
 * <p>Wire shape: POST a multipart upload to the worker, receive a tar.gz of
 * the JADX output tree, extract it into {@code outputDir} by piping the
 * response straight into {@code tar -xzf -}. We never buffer the whole tree
 * in heap — for a big game APK that could be 500MB+.
 *
 * <p>Phase reporting matches the previous in-JVM service so the UI's
 * progress ladder ({@code OPENING_APK} → {@code DECOMPILING}) lights up the
 * same way: {@code OPENING_APK} is asserted before the worker call,
 * {@code DECOMPILING} after the response arrives and we start extracting.
 */
@Service
public class JadxDecompileService {

    private static final Logger log = LoggerFactory.getLogger(JadxDecompileService.class);

    private final JadxWorkerClient worker;
    private final ProjectStorage storage;

    public JadxDecompileService(JadxWorkerClient worker, ProjectStorage storage) {
        this.worker = worker;
        this.storage = storage;
    }

    public record DecompileResult(String packageName) {}

    public DecompileResult decompile(Path apk, Path outputDir) throws IOException {
        return decompile(apk, outputDir, phase -> {}, null, null);
    }

    public DecompileResult decompile(Path apk, Path outputDir, Consumer<String> phaseReporter) throws IOException {
        return decompile(apk, outputDir, phaseReporter, null, null);
    }

    /**
     * Decompile {@code apk} into {@code outputDir} and push the resulting tree
     * to durable storage. When {@code userId} and {@code projectId} are both
     * non-null, the S3 backend (if active) packages outputDir into a tar.gz
     * and uploads it as a single object; otherwise the post-decompile push is
     * skipped (used by the no-arg overloads in tests / one-off calls that
     * don't have a project context).
     */
    public DecompileResult decompile(Path apk, Path outputDir, Consumer<String> phaseReporter,
                                     UUID userId, UUID projectId) throws IOException {
        Files.createDirectories(outputDir);

        String filename = apk.getFileName() != null ? apk.getFileName().toString() : "input.apk";

        log.info("Starting JADX decompile via worker: apk={} out={}", apk, outputDir);
        long start = System.currentTimeMillis();

        phaseReporter.accept("OPENING_APK");
        try (var resp = invokeWorker(apk, filename)) {
            if (!resp.isOk()) {
                String snippet = readErrorSnippet(resp.body());
                throw new IOException("jadx-worker returned status " + resp.status() + ": " + snippet);
            }
            phaseReporter.accept("DECOMPILING");
            extractTarGz(resp.body(), outputDir);
        }

        long ms = System.currentTimeMillis() - start;
        log.info("JADX decompile completed in {} ms", ms);

        // Persist the decompiled tree to durable storage so a task recycle
        // doesn't lose the tree (S3 backend packages it as src.tar.gz). fs
        // backend is a no-op. Synchronous — the project isn't usable until
        // the bytes are safe.
        if (userId != null && projectId != null) {
            try {
                storage.afterDecompile(userId, projectId);
            } catch (IOException e) {
                log.error("afterDecompile push failed for project {}: {}", projectId, e.toString());
                throw e;
            }
        }

        return new DecompileResult(extractPackageName(outputDir));
    }

    private JadxWorkerClient.WorkerResponse invokeWorker(Path apk, String filename) throws IOException {
        try {
            return worker.decompile(apk, filename);
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            throw new IOException("jadx-worker call interrupted", e);
        }
    }

    /**
     * Pipe the tar.gz response stream into {@code tar -xzf - -C <outputDir>}.
     * Shelling out to {@code tar} is cheaper than carrying a Java tar library
     * and works on every Linux container we ship into. {@code tar} preserves
     * directory structure, handles long filenames, and streams the input —
     * no heap buffering for big trees.
     */
    private void extractTarGz(InputStream tarGzStream, Path outputDir) throws IOException {
        ProcessBuilder pb = new ProcessBuilder("tar", "-xzf", "-", "-C", outputDir.toString())
                .redirectErrorStream(true);
        Process proc = pb.start();
        try {
            try (OutputStream stdin = proc.getOutputStream()) {
                tarGzStream.transferTo(stdin);
            }
            // Drain stdout so the child process doesn't block on a full pipe;
            // keep it small — failures surface in the exit code.
            byte[] stderr = proc.getInputStream().readAllBytes();
            int rc = proc.waitFor();
            if (rc != 0) {
                String msg = new String(stderr, StandardCharsets.UTF_8);
                throw new IOException("tar extraction failed rc=" + rc + ": " + abbreviate(msg));
            }
        } catch (InterruptedException e) {
            proc.destroyForcibly();
            Thread.currentThread().interrupt();
            throw new IOException("tar extraction interrupted", e);
        }
    }

    private static String readErrorSnippet(InputStream body) {
        if (body == null) return "";
        try (var bos = new ByteArrayOutputStream()) {
            byte[] buf = new byte[4096];
            int total = 0, n;
            while ((n = body.read(buf)) != -1 && total < 8192) {
                bos.write(buf, 0, n);
                total += n;
            }
            return bos.toString(StandardCharsets.UTF_8);
        } catch (IOException e) {
            return "<unreadable: " + e.getMessage() + ">";
        }
    }

    private static String abbreviate(String s) {
        if (s == null) return "";
        return s.length() > 500 ? s.substring(0, 500) + "…" : s;
    }

    private String extractPackageName(Path outputDir) {
        // JADX writes the decoded manifest to either resources/AndroidManifest.xml or
        // (older versions) to the root. Try both.
        Path[] candidates = new Path[] {
                outputDir.resolve("resources").resolve("AndroidManifest.xml"),
                outputDir.resolve("AndroidManifest.xml"),
        };
        for (Path manifest : candidates) {
            if (!Files.exists(manifest)) continue;
            try {
                var factory = DocumentBuilderFactory.newInstance();
                factory.setFeature("http://apache.org/xml/features/disallow-doctype-decl", true);
                factory.setFeature("http://xml.org/sax/features/external-general-entities", false);
                factory.setFeature("http://xml.org/sax/features/external-parameter-entities", false);
                factory.setXIncludeAware(false);
                factory.setExpandEntityReferences(false);
                Document doc = factory.newDocumentBuilder().parse(manifest.toFile());
                var root = doc.getDocumentElement();
                if (root != null && "manifest".equals(root.getNodeName())) {
                    String pkg = root.getAttribute("package");
                    if (pkg != null && !pkg.isBlank()) return pkg;
                }
            } catch (Exception e) {
                log.debug("Failed to parse manifest {}: {}", manifest, e.toString());
            }
        }
        return null;
    }
}
