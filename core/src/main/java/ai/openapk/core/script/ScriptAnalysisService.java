package ai.openapk.core.script;

import ai.openapk.core.analysis.AnalysisMode;
import ai.openapk.core.auth.User;
import ai.openapk.core.config.OpenApkProperties;
import ai.openapk.core.projects.Project;
import ai.openapk.core.projects.ProjectKind;
import ai.openapk.core.projects.ProjectRepository;
import ai.openapk.core.projects.ProjectStatus;
import ai.openapk.core.projects.WorkflowStatus;
import ai.openapk.core.projects.dto.ProjectResponse;
import ai.openapk.core.script.dto.ScriptAnalysisFindings;
import tools.jackson.databind.ObjectMapper;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.multipart.MultipartFile;
import org.springframework.web.server.ResponseStatusException;
import software.amazon.awssdk.core.ResponseBytes;
import software.amazon.awssdk.core.sync.RequestBody;
import software.amazon.awssdk.services.s3.S3Client;
import software.amazon.awssdk.services.s3.model.GetObjectRequest;
import software.amazon.awssdk.services.s3.model.PutObjectRequest;

import java.io.IOException;
import java.io.InputStream;
import java.time.Instant;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.UUID;

/**
 * Coordinates the script-worker Lambda pipeline:
 * <ol>
 *   <li>Validate the upload (size + filename).</li>
 *   <li>Create a SCRIPT project row.</li>
 *   <li>Upload the tarball to the analysis S3 bucket under
 *       {@code scripts/{projectId}/input.tgz}.</li>
 *   <li>Synchronously invoke the script-worker Lambda with the S3 key.</li>
 *   <li>Read the worker's findings.json from S3 and persist a
 *       {@link ScriptAnalysis} row.</li>
 *   <li>Flip project status to READY.</li>
 * </ol>
 *
 * <p>Synchronous on purpose — the Lambda is bounded at 60s + we cap the
 * SDK invoke at 90s, well below any reasonable HTTP timeout, and the
 * UX is "upload, wait briefly, see findings." If the bound proves wrong
 * later we'll move to the same async-after-commit pattern the BIN flow
 * uses.
 */
@Service
@ConditionalOnProperty(name = "openapk.script-analyzer.enabled", havingValue = "true")
public class ScriptAnalysisService {

    private static final Logger log = LoggerFactory.getLogger(ScriptAnalysisService.class);

    private final ProjectRepository projects;
    private final ScriptAnalysisRepository analyses;
    private final LambdaInvoker invoker;
    private final ScriptEcosystemDetector ecosystemDetector;
    private final S3Client s3;
    private final ObjectMapper mapper;
    private final OpenApkProperties.AnalysisStorage s3Config;
    private final OpenApkProperties.ScriptAnalyzer cfg;

    public ScriptAnalysisService(
            ProjectRepository projects,
            ScriptAnalysisRepository analyses,
            LambdaInvoker invoker,
            ScriptEcosystemDetector ecosystemDetector,
            @Qualifier("analysisS3Client") S3Client analysisS3Client,
            ObjectMapper mapper,
            OpenApkProperties props
    ) {
        this.projects = projects;
        this.analyses = analyses;
        this.invoker = invoker;
        this.ecosystemDetector = ecosystemDetector;
        this.s3 = analysisS3Client;
        this.mapper = mapper;
        this.s3Config = props.analysisStorage();
        this.cfg = props.scriptAnalyzer();
    }

    @Transactional
    public ProjectResponse uploadAndAnalyze(User user, MultipartFile file) {
        if (file.isEmpty()) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "uploaded file is empty");
        }
        long maxBytes = cfg.maxUploadBytes() != null ? cfg.maxUploadBytes() : 25L * 1024 * 1024;
        if (file.getSize() > maxBytes) {
            throw new ResponseStatusException(HttpStatus.PAYLOAD_TOO_LARGE,
                    "upload exceeds " + maxBytes + "-byte cap");
        }
        // Reject native executables up front. The npm/pypi/shell analyzers
        // only understand text-based package ecosystems — a PE/ELF/Mach-O
        // file falls through to the npm worker, which "analyzes" raw machine
        // code as if it were JavaScript and emits a meaningless report. Native
        // binaries are decompiled only by the desktop CLI (local Ghidra), so
        // bounce them here with a clear pointer instead of creating junk.
        String exeKind = nativeExecutableKind(file);
        if (exeKind != null) {
            throw new ResponseStatusException(HttpStatus.UNSUPPORTED_MEDIA_TYPE,
                    "This looks like a " + exeKind + " executable. Executables and native "
                    + "binaries are decompiled only through the OpenBIN desktop CLI (local "
                    + "Ghidra) — not the script analyzer. Install it from openbin.ai and run "
                    + "`openbin decompile <file>`. The script analyzer only accepts source "
                    + "packages: npm/PyPI archives and shell/JS/Python scripts.");
        }
        if (s3Config == null || s3Config.bucket() == null || s3Config.bucket().isBlank()) {
            throw new ResponseStatusException(HttpStatus.SERVICE_UNAVAILABLE,
                    "analysis storage is not configured");
        }
        String filename = sanitizeFilename(file.getOriginalFilename());
        // S3 content-type is best-effort here; the Lambda sniffs magic bytes
        // anyway so a wrong header isn't load-bearing.
        String contentType = guessContentType(filename);

        // Persist the project row first so the user sees it immediately + we
        // have a UUID to namespace the S3 keys under.
        Project project = new Project();
        project.setUser(user);
        project.setKind(ProjectKind.SCRIPT);
        project.setOriginalFilename(filename);
        project.setName(filename);
        project.setSizeBytes(file.getSize());
        project.setStatus(ProjectStatus.DECOMPILING);  // reused as "analyzing"
        project.setWorkflowStatus(WorkflowStatus.ANALYZING);
        project.setAnalysisMode(AnalysisMode.MALWARE);
        project.setSha256("pending");
        project = projects.saveAndFlush(project);

        UUID projectId = project.getId();
        // Detect BEFORE the S3 upload — MultipartFile.getInputStream() can
        // be called multiple times (Spring buffers it), but we want to
        // know which Lambda to target before paying the upload cost.
        ScriptEcosystem ecosystem = ecosystemDetector.detect(file);
        String functionName = resolveFunctionName(ecosystem);
        if (functionName == null || functionName.isBlank()) {
            throw new ResponseStatusException(HttpStatus.SERVICE_UNAVAILABLE,
                    "no Lambda configured for ecosystem " + ecosystem);
        }
        // Key stays {projectId}/input.tgz regardless of actual format —
        // each worker sniffs the magic bytes inside. Keeping the extension
        // stable means the lifecycle policy + reanalyze paths don't fork.
        String inputKey = "scripts/" + projectId + "/input.tgz";

        try {
            // Stream the upload directly to S3 — we never need it on disk.
            try {
                s3.putObject(
                        PutObjectRequest.builder()
                                .bucket(s3Config.bucket())
                                .key(inputKey)
                                .contentType(contentType)
                                .contentLength(file.getSize())
                                .build(),
                        RequestBody.fromInputStream(file.getInputStream(), file.getSize())
                );
            } catch (IOException e) {
                throw new ResponseStatusException(HttpStatus.INTERNAL_SERVER_ERROR,
                        "failed to upload to S3: " + e.getMessage());
            }

            // shell-worker uses originalName to preserve the extension when
            // the single-file path renames to a generic input.tgz S3 key.
            // The npm + pypi workers ignore the field, so always send it.
            Map<String, Object> event = Map.of(
                    "s3Bucket", s3Config.bucket(),
                    "s3InputKey", inputKey,
                    "projectId", projectId.toString(),
                    "originalName", filename
            );
            log.info("invoking {} ({}) for project={}", functionName, ecosystem, projectId);
            byte[] respBytes;
            try {
                respBytes = invoker.invoke(functionName, event);
            } catch (LambdaInvoker.LambdaInvocationException e) {
                // Map common worker errors to actionable HTTP statuses
                // rather than the generic 500 the unhandled stack would
                // produce. The most common one in practice is the user
                // uploading a Datadog-shipped encrypted zip without
                // extracting it first.
                String msg = e.getMessage() == null ? "" : e.getMessage();
                if (msg.contains("Entry encrypted") || msg.contains("entry encrypted")) {
                    throw new ResponseStatusException(HttpStatus.BAD_REQUEST,
                            "This zip is encrypted. The Datadog malicious-packages dataset uses the password " +
                            "'infected' — unzip locally with `unzip -P infected <file>.zip`, then upload the " +
                            "extracted folder (the analyzer will repack it on the fly).");
                }
                if (msg.contains("event missing")) {
                    throw new ResponseStatusException(HttpStatus.INTERNAL_SERVER_ERROR,
                            "internal error: malformed worker event");
                }
                // Anything else: bubble up as 502 so the user sees the
                // worker message without a stack trace.
                throw new ResponseStatusException(HttpStatus.BAD_GATEWAY,
                        "analyzer failed: " + msg);
            }
            WorkerResponse resp;
            try {
                resp = mapper.readValue(respBytes, WorkerResponse.class);
            } catch (Exception e) {
                throw new ResponseStatusException(HttpStatus.BAD_GATEWAY,
                        "script-worker returned malformed response: " + e.getMessage());
            }
            if (resp.findingsKey() == null) {
                throw new ResponseStatusException(HttpStatus.BAD_GATEWAY,
                        "script-worker did not return a findings key");
            }

            // Pull the findings JSON back from S3 — Lambda response only
            // carried keys + a small summary to stay under the 6MB sync-
            // invoke payload ceiling.
            ResponseBytes<?> findingsBytes = s3.getObjectAsBytes(
                    GetObjectRequest.builder()
                            .bucket(s3Config.bucket())
                            .key(resp.findingsKey())
                            .build()
            );
            byte[] findingsJsonBytes = findingsBytes.asByteArray();
            ScriptAnalysisFindings findings;
            try {
                findings = mapper.readValue(findingsJsonBytes, ScriptAnalysisFindings.class);
            } catch (Exception e) {
                throw new ResponseStatusException(HttpStatus.BAD_GATEWAY,
                        "could not parse findings JSON: " + e.getMessage());
            }

            ScriptAnalysis row = persistAnalysis(projectId, findingsJsonBytes, findings, resp.bundleKey());

            // Project goes READY + workflow continues toward the report stage.
            project.setStatus(ProjectStatus.READY);
            project.setSha256(row.getProjectId().toString()); // not a real sha — UI uses findingCount
            projects.save(project);

            return ProjectResponse.from(project);
        } catch (RuntimeException e) {
            project.setStatus(ProjectStatus.FAILED);
            projects.save(project);
            throw e;
        }
    }

    /**
     * Owner-gated read check used by the controller. Read access is owner-
     * only until B.4 wires the same {@code findAccessibleByIdAndUserId}
     * collab query through; community readers go through a separate
     * publish flow (different endpoint, different bytes).
     */
    @Transactional(readOnly = true)
    public boolean callerCanRead(UUID userId, UUID projectId) {
        return projects.findById(projectId)
                .map(p -> p.getUser() != null && userId.equals(p.getUser().getId()))
                .orElse(false);
    }

    private ScriptAnalysis persistAnalysis(UUID projectId, byte[] findingsJson,
                                            ScriptAnalysisFindings findings,
                                            String bundleKey) {
        ScriptAnalysis row = new ScriptAnalysis();
        row.setProjectId(projectId);
        row.setFindingsJson(new String(findingsJson, java.nio.charset.StandardCharsets.UTF_8));
        row.setBundleS3Key(bundleKey);
        row.setFindingsText(buildFindingsText(findings));
        if (findings.summary() != null && findings.summary().pkg() != null) {
            row.setPackageName(findings.summary().pkg().name());
            row.setPackageVersion(findings.summary().pkg().version());
        }
        Map<String, Integer> counts = findings.summary() != null && findings.summary().countsBySeverity() != null
                ? findings.summary().countsBySeverity()
                : Map.of();
        int critical = counts.getOrDefault("CRITICAL", 0);
        int high = counts.getOrDefault("HIGH", 0);
        int medium = counts.getOrDefault("MEDIUM", 0);
        int info = counts.getOrDefault("INFO", 0);
        row.setCriticalCount(critical);
        row.setHighCount(high);
        row.setMediumCount(medium);
        row.setInfoCount(info);
        row.setFindingCount(critical + high + medium + info);
        row.setDurationMs(findings.durationMs());
        row.setAnalyzedAt(Instant.now());
        return analyses.saveAndFlush(row);
    }

    /**
     * Flatten per-finding snippets + messages into a single text blob
     * for the FTS index. Captures the indicator strings (URLs, env var
     * names, paths) that users grep for in the community search bar.
     */
    private static String buildFindingsText(ScriptAnalysisFindings findings) {
        if (findings == null || findings.findings() == null) return "";
        StringBuilder sb = new StringBuilder();
        List<ScriptAnalysisFindings.Finding> list = findings.findings();
        for (var f : list) {
            sb.append(f.rule()).append(' ');
            if (f.message() != null) sb.append(f.message()).append(' ');
            if (f.snippet() != null) sb.append(f.snippet()).append(' ');
            if (f.evidence() != null) {
                for (var v : f.evidence().values()) {
                    if (v != null) sb.append(v).append(' ');
                }
            }
            sb.append('\n');
        }
        return sb.toString();
    }

    /**
     * Classify native-executable magic numbers so we can bounce them before
     * the analyzer wastes an invocation on bytes it can't understand. Returns
     * a human label ("Windows", "Linux ELF", "macOS Mach-O") or null when the
     * upload isn't a recognized executable. A malformed/short read returns
     * null so the normal pipeline still handles the edge case.
     */
    private static String nativeExecutableKind(MultipartFile file) {
        byte[] m;
        try (InputStream in = file.getInputStream()) {
            m = in.readNBytes(4);
        } catch (IOException e) {
            return null;
        }
        if (m.length < 4) return null;
        int b0 = m[0] & 0xff, b1 = m[1] & 0xff, b2 = m[2] & 0xff, b3 = m[3] & 0xff;
        if (b0 == 0x4d && b1 == 0x5a) return "Windows";                       // "MZ" — PE
        if (b0 == 0x7f && b1 == 0x45 && b2 == 0x4c && b3 == 0x46) return "Linux ELF"; // 0x7f E L F
        long be = ((long) b0 << 24) | ((long) b1 << 16) | ((long) b2 << 8) | b3;
        // Mach-O 32/64-bit (both byte orders) + universal "fat" binaries.
        if (be == 0xfeedfaceL || be == 0xfeedfacfL
                || be == 0xcffaedfeL || be == 0xcefaedfeL
                || be == 0xcafebabeL || be == 0xbebafecaL) {
            return "macOS Mach-O";
        }
        return null;
    }

    private static String sanitizeFilename(String raw) {
        if (raw == null || raw.isBlank()) return "package.tgz";
        String name = raw.toLowerCase(Locale.ROOT)
                .replaceAll("[^a-z0-9._@+-]+", "-");
        return name.length() > 200 ? name.substring(0, 200) : name;
    }

    /**
     * Best-effort MIME for the S3 PutObject. Lambda sniffs magic bytes
     * itself, so a mislabel here doesn't break analysis — it just affects
     * downstream tooling that reads S3 metadata.
     */
    private static String guessContentType(String filename) {
        if (filename == null) return "application/octet-stream";
        String lower = filename.toLowerCase(Locale.ROOT);
        if (lower.endsWith(".zip")) return "application/zip";
        if (lower.endsWith(".tgz") || lower.endsWith(".tar.gz")) return "application/gzip";
        if (lower.endsWith(".js") || lower.endsWith(".mjs") || lower.endsWith(".cjs")) return "application/javascript";
        return "application/octet-stream";
    }

    /**
     * Pick the Lambda function name for a given ecosystem. Both names come
     * from {@code application.yml}; an unconfigured slot yields {@code null}
     * which {@link #uploadAndAnalyze} surfaces as a 503 — that's better than
     * a generic 500 when the prod env is missing a config key.
     */
    private String resolveFunctionName(ScriptEcosystem ecosystem) {
        return switch (ecosystem) {
            case NPM -> cfg.lambdaFunctionName();
            case PYPI -> cfg.pypiLambdaFunctionName();
            case SHELL -> cfg.shellLambdaFunctionName();
        };
    }

    /** Tiny inner record matching the worker's return shape. */
    private record WorkerResponse(String findingsKey, String bundleKey,
                                  Map<String, Object> summary) {}
}
