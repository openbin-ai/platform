package ai.openapk.core.analysis;

import ai.openapk.core.analysis.dto.AnalysisResponse;
import ai.openapk.core.analysis.dto.AskFunctionRequest;
import ai.openapk.core.analysis.dto.AskResponse;
import ai.openapk.core.analysis.dto.BinaryDigest;
import ai.openapk.core.analysis.dto.Hotspot;
import ai.openapk.core.analysis.dto.Ioc;
import ai.openapk.core.analysis.dto.StaticDigest;
import ai.openapk.core.auth.User;
import ai.openapk.core.credentials.LlmCredential;
import ai.openapk.core.credentials.LlmCredentialRepository;
import ai.openapk.core.projects.Project;
import ai.openapk.core.projects.ProjectAccessGuard;
import ai.openapk.core.projects.ProjectKind;
import ai.openapk.core.projects.ProjectRepository;
import ai.openapk.core.projects.ProjectStatus;
import ai.openapk.core.projects.analysis.BinaryAnalysisLoader;
import ai.openapk.core.renames.RenameService;
import ai.openapk.core.script.ScriptAnalysisRepository;
import ai.openapk.core.script.dto.ScriptAnalysisFindings;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.transaction.support.TransactionTemplate;
import org.springframework.web.server.ResponseStatusException;
import org.springframework.web.servlet.mvc.method.annotation.SseEmitter;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;

import java.io.IOException;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.UUID;

@Service
public class AnalysisService {

    private static final Logger log = LoggerFactory.getLogger(AnalysisService.class);

    /** Max source-file size (bytes) we send to the LLM for /ask. Larger files get truncated. */
    private static final int ASK_MAX_FILE_BYTES = 60 * 1024;
    private static final int ANALYSIS_MAX_TOKENS = 2048;
    private static final int ASK_MAX_TOKENS = 1500;
    /** Disassembly cap for /ask-function. ~500 instructions covers most real
     *  functions; the long tail is truncated so prompts stay bounded. */
    private static final int ASK_FN_MAX_DISASM_LINES = 500;

    private final ProjectRepository projectRepo;
    private final LlmCredentialRepository credRepo;
    private final StaticDigestService digester;
    private final BinaryDigestService binaryDigester;
    private final PromptBuilder prompts;
    private final LlmInvoker invoker;
    private final StreamingLlmInvoker streamingInvoker;
    private final RenameService renameService;
    private final ObjectMapper mapper;
    private final TransactionTemplate tx;
    private final BinaryAnalysisLoader analysisLoader;
    private final ProjectAccessGuard guard;
    /** Optional — only present when openapk.script-analyzer.enabled=true. */
    private final ScriptAnalysisRepository scriptAnalyses;

    public AnalysisService(
            ProjectRepository projectRepo,
            LlmCredentialRepository credRepo,
            StaticDigestService digester,
            BinaryDigestService binaryDigester,
            PromptBuilder prompts,
            LlmInvoker invoker,
            StreamingLlmInvoker streamingInvoker,
            RenameService renameService,
            ObjectMapper mapper,
            TransactionTemplate tx,
            BinaryAnalysisLoader analysisLoader,
            ProjectAccessGuard guard,
            org.springframework.beans.factory.ObjectProvider<ScriptAnalysisRepository> scriptAnalysesProvider
    ) {
        this.projectRepo = projectRepo;
        this.credRepo = credRepo;
        this.digester = digester;
        this.binaryDigester = binaryDigester;
        this.prompts = prompts;
        this.invoker = invoker;
        this.streamingInvoker = streamingInvoker;
        this.renameService = renameService;
        this.mapper = mapper;
        this.tx = tx;
        this.analysisLoader = analysisLoader;
        this.guard = guard;
        // ObjectProvider so a dev profile with the script analyzer
        // disabled still wires AnalysisService — the repo bean only
        // exists when the script-analyzer config is on.
        this.scriptAnalyses = scriptAnalysesProvider.getIfAvailable();
    }

    /**
     * Return the most recent {@code /analyze} response cached on the project,
     * or {@code null} when nothing has been run yet. Lets the Analysis tab
     * rehydrate after a page refresh without spending tokens.
     */
    @Transactional(readOnly = true)
    public AnalysisResponse latestAnalysis(User user, UUID projectId) {
        Project project = guard.requireRead(user, projectId);
        String cached = project.getLatestAnalysisJson();
        if (cached == null || cached.isBlank()) return null;
        try {
            return mapper.readValue(cached, AnalysisResponse.class);
        } catch (Exception e) {
            // Stale schema; treat as no cache so the user can re-run.
            return null;
        }
    }

    @Transactional
    public AnalysisResponse analyze(User user, UUID projectId, AnalysisMode mode, UUID credentialId, String model) {
        // EDITOR: analyze persists latestAnalysisJson + advances workflow.
        Project project = guard.requireEdit(user, projectId);
        if (project.getStatus() != ProjectStatus.READY) {
            throw new ResponseStatusException(HttpStatus.CONFLICT,
                    "project is not READY (current status: " + project.getStatus() + ")");
        }
        LlmCredential cred = loadCredential(user, credentialId);

        // Kind-aware digest + prompt. The downstream LLM call, response
        // parsing, and caching are identical for both kinds because both
        // digests expose iocs() and the LLM is constrained to return the same
        // JSON shape; only the "what does signal look like" layer differs.
        String systemPrompt;
        String userPrompt;
        List<Ioc> iocs;
        if (project.getKind() == ProjectKind.BIN) {
            BinaryDigest digest = binaryDigester.computeFromProject(project);
            systemPrompt = prompts.binarySystemPrompt(mode);
            userPrompt = prompts.userPrompt(digest);
            iocs = digest.iocs();
        } else if (project.getKind() == ProjectKind.SCRIPT) {
            // SCRIPT: the worker's findings.json IS the digest. No second
            // pass needed — we re-parse the stored JSONB into the DTO and
            // hand it to the prompt builder. IoCs come from the URL-bearing
            // rules (known-c2 + net-exfil) via PromptBuilder helper.
            if (scriptAnalyses == null) {
                throw new ResponseStatusException(HttpStatus.SERVICE_UNAVAILABLE,
                        "script analyzer is not enabled on this backend");
            }
            ScriptAnalysisFindings findings = loadScriptFindings(projectId);
            systemPrompt = prompts.scriptSystemPrompt(mode);
            userPrompt = prompts.userPrompt(findings);
            iocs = prompts.iocsFromFindings(findings);
        } else {
            StaticDigest digest = loadOrComputeDigest(user, project);
            systemPrompt = prompts.systemPrompt(mode);
            userPrompt = prompts.userPrompt(digest);
            iocs = digest.iocs();
        }

        var result = invoker.complete(user, projectId, "analyze", cred, systemPrompt, userPrompt, ANALYSIS_MAX_TOKENS, model);
        markCredentialUsed(cred);

        AnalysisResponse response = parseAnalysisResponse(mode, result, iocs);
        // Cache so the report editor (and future re-opens of this project) can
        // pull from analysis without re-spending tokens.
        try {
            project.setLatestAnalysisJson(mapper.writeValueAsString(response));
            if (ai.openapk.core.projects.WorkflowStatus.shouldAdvance(
                    project.getWorkflowStatus(), ai.openapk.core.projects.WorkflowStatus.ANALYZING)) {
                project.setWorkflowStatus(ai.openapk.core.projects.WorkflowStatus.ANALYZING);
            }
            projectRepo.save(project);
        } catch (Exception e) {
            log.warn("failed to persist latest analysis for {}: {}", project.getId(), e.toString());
        }
        return response;
    }

    @Transactional
    public AskResponse ask(User user, UUID projectId, String filePath, String question, UUID credentialId, String model) {
        // VIEWER-OK: AI Q&A doesn't mutate the project (tokens charged
        // to caller's BYOK credential, not the project owner's).
        Project project = guard.requireRead(user, projectId);
        if (project.getStatus() != ProjectStatus.READY) {
            throw new ResponseStatusException(HttpStatus.CONFLICT,
                    "project is not READY (current status: " + project.getStatus() + ")");
        }
        LlmCredential cred = loadCredential(user, credentialId);

        String content;
        boolean truncated;
        try {
            truncated = digester.isFileLargerThan(user, project, filePath, ASK_MAX_FILE_BYTES);
            content = digester.loadFileTextBounded(user, project, filePath, ASK_MAX_FILE_BYTES);
        } catch (IllegalArgumentException e) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, e.getMessage());
        } catch (IOException e) {
            throw new ResponseStatusException(HttpStatus.NOT_FOUND, "file not found: " + filePath);
        }

        String systemPrompt = prompts.askSystemPrompt();
        // Non-streaming variant doesn't carry a thread — pass null priorTurns.
        // Streaming variant is the one the chat UI uses.
        String userPrompt = prompts.askUserPrompt(filePath, content, question, truncated, null);

        var result = invoker.complete(user, projectId, "ask", cred, systemPrompt, userPrompt, ASK_MAX_TOKENS, model);
        markCredentialUsed(cred);
        return new AskResponse(result.text(), result.model(), result.inputTokens(), result.outputTokens());
    }

    /**
     * Streaming variant of {@link #ask}. Loads everything inside one short transaction
     * (so entities aren't lazy-loaded mid-stream), then opens an SSE connection to the
     * provider and forwards chunks to the emitter. Designed to be invoked from a
     * background executor — the caller passes a pre-resolved {@link User}.
     */
    public void streamAsk(
            SseEmitter emitter,
            User user,
            UUID projectId,
            String filePath,
            String question,
            UUID credentialId,
            String model,
            List<ai.openapk.core.analysis.dto.AskRequest.PriorTurn> priorTurns
    ) {
        record Prep(LlmCredential cred, String systemPrompt, String userPrompt) {}
        Prep prep;
        try {
            prep = tx.execute(status -> {
                // VIEWER-OK: streaming Q&A is read-only over project data.
                Project project = guard.requireRead(user, projectId);
                if (project.getStatus() != ProjectStatus.READY) {
                    throw new ResponseStatusException(HttpStatus.CONFLICT,
                            "project is not READY (current status: " + project.getStatus() + ")");
                }
                LlmCredential cred = loadCredential(user, credentialId);
                String content;
                boolean truncated;
                try {
                    truncated = digester.isFileLargerThan(user, project, filePath, ASK_MAX_FILE_BYTES);
                    content = digester.loadFileTextBounded(user, project, filePath, ASK_MAX_FILE_BYTES);
                } catch (IllegalArgumentException e) {
                    throw new ResponseStatusException(HttpStatus.BAD_REQUEST, e.getMessage());
                } catch (IOException e) {
                    throw new ResponseStatusException(HttpStatus.NOT_FOUND, "file not found: " + filePath);
                }
                String systemPrompt = prompts.askSystemPrompt();
                String userPrompt = prompts.askUserPrompt(filePath, content, question, truncated, priorTurns);
                return new Prep(cred, systemPrompt, userPrompt);
            });
        } catch (Exception e) {
            sendError(emitter, e);
            return;
        }

        if (prep == null) {
            sendError(emitter, new IllegalStateException("preparation returned null"));
            return;
        }

        streamingInvoker.stream(
                user, projectId, "ask_stream",
                prep.cred(), prep.systemPrompt(), prep.userPrompt(), ASK_MAX_TOKENS, model,
                new StreamingLlmInvoker.StreamCallback() {
                    @Override
                    public void onChunk(String text) {
                        try {
                            emitter.send(SseEmitter.event().name("chunk").data(Map.of("text", text)));
                        } catch (Exception e) {
                            log.debug("client disconnected mid-stream: {}", e.toString());
                        }
                    }

                    @Override
                    public void onDone(String modelUsed, int inputTokens, int outputTokens) {
                        try {
                            emitter.send(SseEmitter.event().name("done").data(Map.of(
                                    "model", modelUsed,
                                    "inputTokens", inputTokens,
                                    "outputTokens", outputTokens
                            )));
                            emitter.complete();
                        } catch (Exception e) {
                            emitter.completeWithError(e);
                        }
                        // Best-effort update of last-used timestamp.
                        try {
                            tx.executeWithoutResult(status -> credRepo.findById(prep.cred().getId()).ifPresent(c -> {
                                c.setLastUsedAt(Instant.now());
                                credRepo.save(c);
                            }));
                        } catch (Exception ignored) {}
                    }

                    @Override
                    public void onError(Throwable t) {
                        sendError(emitter, t);
                    }
                });
    }

    /**
     * BIN-only function-level Q&A streaming. Mirrors {@link #streamAsk} but
     * loads context from the cached worker JSON (function's signature +
     * decompiled C + first {@value #ASK_FN_MAX_DISASM_LINES} disasm lines)
     * instead of from a source file on disk.
     *
     * <p>{@code priorTurns} is the existing conversation thread for this
     * function — replayed in the user prompt so the model can answer
     * follow-ups. {@code null} or empty for a fresh ask.
     */
    public void streamAskFunction(
            SseEmitter emitter,
            User user,
            UUID projectId,
            String functionName,
            String question,
            UUID credentialId,
            String model,
            List<AskFunctionRequest.PriorTurn> priorTurns
    ) {
        record Prep(LlmCredential cred, String systemPrompt, String userPrompt) {}
        Prep prep;
        try {
            prep = tx.execute(status -> {
                // VIEWER-OK: ask-function reads cached worker JSON, no writes.
                Project project = guard.requireRead(user, projectId);
                if (project.getKind() != ProjectKind.BIN) {
                    throw new ResponseStatusException(HttpStatus.BAD_REQUEST,
                            "ask-function is BIN-only (project kind=" + project.getKind() + ")");
                }
                if (project.getStatus() != ProjectStatus.READY) {
                    throw new ResponseStatusException(HttpStatus.CONFLICT,
                            "project is not READY (current status: " + project.getStatus() + ")");
                }
                String raw = analysisLoader.load(project);
                if (raw == null || raw.isBlank()) {
                    throw new ResponseStatusException(HttpStatus.NOT_FOUND, "no analysis stored for this project");
                }
                LlmCredential cred = loadCredential(user, credentialId);

                JsonNode root;
                try {
                    root = mapper.readTree(raw);
                } catch (Exception e) {
                    throw new ResponseStatusException(HttpStatus.INTERNAL_SERVER_ERROR,
                            "binary analysis JSON unreadable: " + e.getMessage());
                }
                // The frontend gets a fully-renamed view from /binary-analysis,
                // so the name it sends here may be a user-chosen rename rather
                // than the worker's original. resolveOriginal returns the
                // candidate unchanged when no APPLIED rename matches, so the
                // pre-rename UX still works.
                String originalName = renameService.resolveOriginal(projectId, functionName);
                JsonNode fn = findFunctionByName(root.path("functions"), originalName);
                if (fn == null) {
                    throw new ResponseStatusException(HttpStatus.NOT_FOUND,
                            "function not found in this binary: " + functionName);
                }

                String address    = fn.path("address").asString("");
                String signature  = fn.path("signature").asString("");
                String decompiled = fn.path("decompiled").isNull() ? "" : fn.path("decompiled").asString("");

                StringBuilder disasm = new StringBuilder();
                boolean truncated = false;
                JsonNode disasmArr = fn.path("disassembly");
                if (disasmArr.isArray()) {
                    int count = 0;
                    for (JsonNode line : disasmArr) {
                        if (count >= ASK_FN_MAX_DISASM_LINES) { truncated = true; break; }
                        disasm.append(line.path("addr").asString(""))
                                .append("  ")
                                .append(line.path("text").asString(""))
                                .append("\n");
                        count++;
                    }
                }

                String systemPrompt = prompts.askFunctionSystemPrompt();
                String userPrompt = prompts.askFunctionUserPrompt(
                        functionName, address, signature, decompiled, disasm.toString(),
                        question, truncated, priorTurns);
                return new Prep(cred, systemPrompt, userPrompt);
            });
        } catch (Exception e) {
            sendError(emitter, e);
            return;
        }
        if (prep == null) {
            sendError(emitter, new IllegalStateException("preparation returned null"));
            return;
        }

        streamingInvoker.stream(
                user, projectId, "ask_function_stream",
                prep.cred(), prep.systemPrompt(), prep.userPrompt(), ASK_MAX_TOKENS, model,
                streamCallback(emitter, prep.cred().getId()));
    }

    /** Walk the functions array for an exact name match. Linear scan is fine
     *  — there are at most {@code MAX_FUNCTIONS} (5000) entries. */
    private static JsonNode findFunctionByName(JsonNode functions, String name) {
        if (!functions.isArray() || name == null) return null;
        for (JsonNode fn : functions) {
            if (name.equals(fn.path("name").asString(null))) return fn;
        }
        return null;
    }

    /** Shared SSE callback for streaming endpoints — chunks emit `chunk`,
     *  completion emits `done` and bumps the credential's lastUsedAt,
     *  errors emit `error` and close the emitter. */
    private StreamingLlmInvoker.StreamCallback streamCallback(SseEmitter emitter, UUID credentialId) {
        return new StreamingLlmInvoker.StreamCallback() {
            @Override
            public void onChunk(String text) {
                try {
                    emitter.send(SseEmitter.event().name("chunk").data(Map.of("text", text)));
                } catch (Exception e) {
                    log.debug("client disconnected mid-stream: {}", e.toString());
                }
            }

            @Override
            public void onDone(String modelUsed, int inputTokens, int outputTokens) {
                try {
                    emitter.send(SseEmitter.event().name("done").data(Map.of(
                            "model", modelUsed,
                            "inputTokens", inputTokens,
                            "outputTokens", outputTokens
                    )));
                    emitter.complete();
                } catch (Exception e) {
                    emitter.completeWithError(e);
                }
                try {
                    tx.executeWithoutResult(status -> credRepo.findById(credentialId).ifPresent(c -> {
                        c.setLastUsedAt(Instant.now());
                        credRepo.save(c);
                    }));
                } catch (Exception ignored) {}
            }

            @Override
            public void onError(Throwable t) { sendError(emitter, t); }
        };
    }

    private static void sendError(SseEmitter emitter, Throwable t) {
        try {
            emitter.send(SseEmitter.event().name("error").data(Map.of(
                    "message", t.getMessage() == null ? t.getClass().getSimpleName() : t.getMessage()
            )));
            emitter.complete();
        } catch (Exception e) {
            try { emitter.completeWithError(t); } catch (Exception ignored) {}
        }
    }

    private LlmCredential loadCredential(User user, UUID credentialId) {
        return credRepo.findByIdAndUserId(credentialId, user.getId())
                .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND, "credential not found"));
    }

    private void markCredentialUsed(LlmCredential cred) {
        cred.setLastUsedAt(Instant.now());
        credRepo.save(cred);
    }

    /**
     * Force a fresh static-digest scan and persist it, ignoring the cache.
     * Used by the Crypto tab's Rescan button after we change signature patterns —
     * cheap (no LLM call), just overwrites {@code project.digestJson}.
     */
    @Transactional
    public void rescanDigest(User user, UUID projectId) {
        // EDITOR: rescan overwrites the project's cached digestJson.
        Project project = guard.requireEdit(user, projectId);
        if (project.getStatus() != ProjectStatus.READY) {
            throw new ResponseStatusException(HttpStatus.CONFLICT,
                    "project is not READY (current status: " + project.getStatus() + ")");
        }
        // "Rescan" walks the decompiled source tree for new signature patterns
        // — meaningful only for APK projects. BIN digests derive from the
        // already-frozen worker JSON, so rescanning would just recompute the
        // same thing. Surface the mismatch explicitly so the frontend can hide
        // the button on BIN projects instead of silently no-op'ing.
        if (project.getKind() == ProjectKind.BIN) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST,
                    "digest rescan is APK-only; binary digests are derived from frozen worker output");
        }
        try {
            StaticDigest fresh = digester.compute(user, project);
            project.setDigestJson(mapper.writeValueAsString(fresh));
            projectRepo.save(project);
        } catch (IOException e) {
            throw new ResponseStatusException(HttpStatus.INTERNAL_SERVER_ERROR, "digest scan failed: " + e.getMessage());
        }
    }

    /**
     * Pull the persisted {@code findings_jsonb} for a SCRIPT project and
     * deserialize it back into the worker DTO. The worker has already done
     * the analysis; we just rehydrate.
     */
    private ScriptAnalysisFindings loadScriptFindings(UUID projectId) {
        var row = scriptAnalyses.findById(projectId).orElseThrow(() ->
                new ResponseStatusException(HttpStatus.CONFLICT,
                        "no script analysis row for project " + projectId));
        try {
            return mapper.readValue(row.getFindingsJson(), ScriptAnalysisFindings.class);
        } catch (Exception e) {
            throw new ResponseStatusException(HttpStatus.INTERNAL_SERVER_ERROR,
                    "stored findings JSON could not be parsed: " + e.getMessage());
        }
    }

    private StaticDigest loadOrComputeDigest(User user, Project project) {
        String cached = project.getDigestJson();
        if (cached != null && !cached.isBlank()) {
            try {
                return mapper.readValue(cached, StaticDigest.class);
            } catch (Exception e) {
                log.warn("cached digest unparseable for project {}: {}. Recomputing.", project.getId(), e.toString());
            }
        }
        try {
            StaticDigest fresh = digester.compute(user, project);
            project.setDigestJson(mapper.writeValueAsString(fresh));
            projectRepo.save(project);
            return fresh;
        } catch (IOException e) {
            throw new ResponseStatusException(HttpStatus.INTERNAL_SERVER_ERROR, "digest generation failed: " + e.getMessage());
        }
    }

    private AnalysisResponse parseAnalysisResponse(AnalysisMode mode, LlmInvoker.CompletionResult completion, List<Ioc> iocs) {
        String modelOutput = completion.text();
        String cleaned = stripJsonFences(modelOutput.strip());
        try {
            JsonNode root = mapper.readTree(cleaned);
            String summary = root.path("summary").asString("");
            List<Hotspot> hotspots = new ArrayList<>();
            for (JsonNode h : root.path("hotspots")) {
                hotspots.add(new Hotspot(
                        h.path("path").asString(""),
                        h.path("severity").asString("medium"),
                        h.path("reason").asString("")
                ));
            }
            List<String> nextSteps = new ArrayList<>();
            for (JsonNode s : root.path("next_steps")) nextSteps.add(s.asString(""));
            return new AnalysisResponse(mode, summary, hotspots, iocs, nextSteps, modelOutput,
                    completion.model(), completion.inputTokens(), completion.outputTokens());
        } catch (Exception e) {
            log.warn("LLM did not return valid JSON, returning raw: {}", e.toString());
            return new AnalysisResponse(mode, modelOutput, List.of(), iocs, List.of(), modelOutput,
                    completion.model(), completion.inputTokens(), completion.outputTokens());
        }
    }

    private static String stripJsonFences(String s) {
        if (s.startsWith("```")) {
            int firstNl = s.indexOf('\n');
            if (firstNl > 0) s = s.substring(firstNl + 1);
            if (s.endsWith("```")) s = s.substring(0, s.length() - 3);
        }
        return s.strip();
    }
}
