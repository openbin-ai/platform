package ai.openapk.core.projects;

import ai.openapk.core.nativeanalysis.GhidraWorkerClient;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;

import java.io.IOException;
import java.nio.file.Path;
import java.util.function.Consumer;

/**
 * Low-level decompile path for BIN projects. Sibling to
 * {@link JadxDecompileService} — wraps the Ghidra worker HTTP call into
 * something {@link ProjectService} can invoke from its async decompile flow.
 *
 * <p>The worker (Python FastAPI + analyzeHeadless) takes minutes for a
 * non-trivial binary, so callers must invoke this off the request thread
 * (ProjectService already does that via {@code @Async scheduleDecompile}).
 *
 * <p>We don't shred the result into per-function rows here — the raw JSON is
 * returned as-is and the orchestrator persists it onto
 * {@code projects.binary_analysis_jsonb}. Per-function shredding waits until
 * slice 2 (disassembly view) and slice 5 (multi-binary corpora).
 */
@Service
public class BinaryDecompileService {

    private static final Logger log = LoggerFactory.getLogger(BinaryDecompileService.class);

    private final GhidraWorkerClient worker;
    private final ObjectMapper mapper;

    public BinaryDecompileService(GhidraWorkerClient worker, ObjectMapper mapper) {
        this.worker = worker;
        this.mapper = mapper;
    }

    /**
     * Result of a successful decompile. {@code rawJson} is persisted verbatim
     * onto the project row; the remaining fields are the parsed
     * {@code metadata} block, hoisted into typed columns so the UI can filter
     * a project list by arch / format without parsing JSON per row.
     */
    public record DecompileResult(
            String rawJson,
            String arch,
            String executableFormat,
            String compiler,
            String languageId,
            String imageBase,
            int functionCount,
            int stringCount,
            int importCount
    ) {}

    /**
     * Run the binary through the Ghidra worker and return the parsed result.
     *
     * @param binary       absolute path to the uploaded executable
     * @param archHint     caller-supplied arch label, or {@code "auto"} when
     *                     the upload flow has no hint (Ghidra still
     *                     auto-detects for known formats)
     * @param phaseReporter receives coarse pipeline phases (ANALYZING,
     *                     EXTRACTING) so the UI can render progress
     */
    public DecompileResult decompile(Path binary, String archHint, Consumer<String> phaseReporter)
            throws IOException, InterruptedException {

        String filename = binary.getFileName() != null ? binary.getFileName().toString() : "binary";
        String arch = (archHint == null || archHint.isBlank()) ? "auto" : archHint;

        // The worker call is a single blocking HTTP round-trip; we can't see
        // inside it, so we set ANALYZING before and EXTRACTING after as the
        // coarsest meaningful split. The UI's elapsed-time counter is what
        // actually carries the "still running" signal.
        phaseReporter.accept("ANALYZING");
        log.info("Starting Ghidra decompile: binary={} arch={}", binary, arch);
        long start = System.currentTimeMillis();
        var resp = worker.analyze(binary, filename, arch);
        long ms = System.currentTimeMillis() - start;
        log.info("Ghidra worker responded status={} in {}ms", resp.status(), ms);

        if (!resp.isOk()) {
            throw new IOException("Ghidra worker returned status " + resp.status() + ": " + abbreviate(resp.body()));
        }

        phaseReporter.accept("EXTRACTING");
        JsonNode root = mapper.readTree(resp.body());
        if (root.has("error")) {
            throw new IOException("Ghidra worker reported an error: " + root.get("error").asString(""));
        }

        JsonNode meta = root.path("metadata");
        return new DecompileResult(
                resp.body(),
                textOrNull(meta, "arch"),
                textOrNull(meta, "executable_format"),
                textOrNull(meta, "compiler"),
                textOrNull(meta, "language"),
                textOrNull(meta, "image_base"),
                root.path("functions").size(),
                root.path("strings").size(),
                root.path("imports").size()
        );
    }

    private static String textOrNull(JsonNode node, String field) {
        JsonNode v = node.path(field);
        if (v.isMissingNode() || v.isNull()) return null;
        String s = v.asString("");
        return s.isBlank() ? null : s;
    }

    private static String abbreviate(String s) {
        if (s == null) return "";
        return s.length() > 500 ? s.substring(0, 500) + "…" : s;
    }
}
