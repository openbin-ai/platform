package ai.openapk.core.renames;

import ai.openapk.core.analysis.LlmInvoker;
import ai.openapk.core.auth.User;
import ai.openapk.core.credentials.LlmCredential;
import ai.openapk.core.credentials.LlmCredentialRepository;
import ai.openapk.core.projects.Project;
import ai.openapk.core.projects.ProjectAccessGuard;
import ai.openapk.core.projects.ProjectKind;
import ai.openapk.core.projects.ProjectRepository;
import ai.openapk.core.projects.ProjectStatus;
import ai.openapk.core.projects.analysis.BinaryAnalysisLoader;
import ai.openapk.core.projects.storage.ProjectStorage;
import ai.openapk.core.renames.dto.ApplyRenamesRequest;
import ai.openapk.core.renames.dto.ManualRenameRequest;
import ai.openapk.core.renames.dto.RenameDto;
import ai.openapk.core.renames.dto.SuggestFunctionRenamesRequest;
import ai.openapk.core.renames.dto.SuggestRenamesRequest;
import ai.openapk.core.renames.dto.SuggestRenamesResponse;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.server.ResponseStatusException;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;
import tools.jackson.databind.node.ArrayNode;
import tools.jackson.databind.node.ObjectNode;

import java.io.IOException;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Instant;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

@Service
public class RenameService {

    private static final Logger log = LoggerFactory.getLogger(RenameService.class);

    private static final int LARGE_FILE_LINES = 1500;
    private static final int CHUNK_LINES = 1200;
    private static final int OVERLAP_LINES = 100;
    private static final int MAX_FILE_BYTES = 200 * 1024;
    private static final int MAX_TOKENS = 2048;

    /** Compact JSON-only prompt to keep token cost predictable. */
    private static final String SYSTEM_PROMPT = """
            You are analyzing decompiled Java source from an Android APK that has been obfuscated \
            (likely ProGuard/R8). Suggest readable replacement names for opaque identifiers.

            Rules:
            1. Only suggest renames where you have high or medium confidence.
            2. Skip identifiers that are already meaningful (onCreate, MainActivity, getUserId, etc.).
            3. Skip Java/Android framework names (Activity, View, Context, String, List, etc.).
            4. Use the BARE identifier name exactly as it appears in source — no package prefix.
            5. Scope must be one of: "class", "method", "field". Do NOT suggest local variables \
               or method parameters.
            6. Confidence: "high" if purpose is clear from usage; "medium" if reasonable inference; \
               omit anything you would call "low".

            Return ONLY a JSON object — no markdown, no commentary — with this exact shape:
            {
              "renames": [
                {
                  "original": "a",
                  "suggested": "UserManager",
                  "scope": "class",
                  "confidence": "high",
                  "rationale": "Has methods loadUser, saveUser, logout."
                }
              ]
            }
            """;

    /**
     * BIN-specific suggest prompt. Scope is restricted to {@code function}
     * (rename the outer symbol) and {@code variable} (params + locals). The
     * decompiler is Ghidra so its placeholder conventions are baked in to
     * the rules so the model knows what's worth renaming and what's already
     * meaningful.
     */
    private static final String SYSTEM_PROMPT_BIN_FUNCTION = """
            You are analyzing a single function from a binary that has been decompiled \
            by Ghidra. The decompiler auto-generates names for things it can't infer: \
            functions become FUN_<address> (or entry/sub_<address>), locals become \
            uVarN / iVarN / pcVarN / lVarN / local_N, parameters become param_1 / \
            param_2 / ... Your job is to suggest readable replacement names based on \
            what the function actually does.

            Rules:
            1. Suggest a function name ONLY if the current name is an auto-generated \
               placeholder (FUN_..., entry, sub_..., __<digits>...). Skip if the name \
               is already meaningful (printf, main, decryptPayload, etc.).
            2. Suggest renames for parameters (param_N) and locals (uVarN/iVarN/pcVarN/ \
               local_N) where you have high or medium confidence in their purpose.
            3. Skip C standard library / OS API names (printf, malloc, CreateFileW, \
               GetProcAddress, etc.) — those are imports, not user code.
            4. Use the BARE identifier exactly as it appears in the decompiled code.
            5. Scope must be one of: "function", "variable". Use "function" only for \
               the outer function being analyzed; everything else is "variable".
            6. Confidence: "high" if purpose is clear from usage; "medium" if reasonable \
               inference; omit anything you would call "low".

            Return ONLY a JSON object — no markdown, no commentary — with this exact shape:
            {
              "renames": [
                {
                  "original": "FUN_00401050",
                  "suggested": "parseHeader",
                  "scope": "function",
                  "confidence": "high",
                  "rationale": "Reads first 16 bytes, validates magic 'MZ', returns offset."
                },
                {
                  "original": "param_1",
                  "suggested": "buffer",
                  "scope": "variable",
                  "confidence": "high",
                  "rationale": "Passed to memcpy as destination."
                }
              ]
            }
            """;

    private final ProjectRepository projectRepo;
    private final ProjectRenameRepository renameRepo;
    private final LlmCredentialRepository credRepo;
    private final ProjectStorage storage;
    private final LlmInvoker invoker;
    private final ObjectMapper mapper;
    private final BinaryAnalysisLoader analysisLoader;
    private final ProjectAccessGuard guard;

    public RenameService(
            ProjectRepository projectRepo,
            ProjectRenameRepository renameRepo,
            LlmCredentialRepository credRepo,
            ProjectStorage storage,
            LlmInvoker invoker,
            ObjectMapper mapper,
            BinaryAnalysisLoader analysisLoader,
            ProjectAccessGuard guard
    ) {
        this.projectRepo = projectRepo;
        this.renameRepo = renameRepo;
        this.credRepo = credRepo;
        this.storage = storage;
        this.invoker = invoker;
        this.mapper = mapper;
        this.analysisLoader = analysisLoader;
        this.guard = guard;
    }

    // -------------------------------------------------------------------
    // API methods
    // -------------------------------------------------------------------

    @Transactional(readOnly = true)
    public List<RenameDto> list(User user, UUID projectId) {
        // VIEWER-OK: reading the rename roster doesn't mutate.
        guard.requireRead(user, projectId);
        return renameRepo.findByProjectIdOrderByCreatedAtDesc(projectId)
                .stream().map(RenameDto::from).toList();
    }

    @Transactional
    public SuggestRenamesResponse suggest(User user, UUID projectId, SuggestRenamesRequest req) {
        Project project = loadEditableProjectReady(user, projectId);
        LlmCredential cred = loadCredential(user, req.credentialId());

        String content = readRawFile(user, projectId, req.filePath());
        List<String> chunks = chunkContent(content);
        log.info("rename suggest: project={} file={} bytes={} chunks={}",
                projectId, req.filePath(), content.length(), chunks.size());

        List<RawSuggestion> aggregated = new ArrayList<>();
        int totalInput = 0;
        int totalOutput = 0;
        String modelUsed = null;
        for (int i = 0; i < chunks.size(); i++) {
            String userPrompt = buildUserPrompt(chunks.get(i), req.filePath(), i, chunks.size());
            var result = invoker.complete(user, projectId, "rename", cred, SYSTEM_PROMPT, userPrompt, MAX_TOKENS, req.model());
            modelUsed = result.model();
            totalInput += result.inputTokens();
            totalOutput += result.outputTokens();
            aggregated.addAll(parseSuggestions(result.text()));
        }
        markCredentialUsed(cred);

        // Dedup by original (first wins — usually consistent across chunks).
        Map<String, RawSuggestion> deduped = new LinkedHashMap<>();
        for (RawSuggestion s : aggregated) deduped.putIfAbsent(s.original, s);

        List<RenameDto> savedDtos = new ArrayList<>();
        for (RawSuggestion s : deduped.values()) {
            ProjectRename existing = renameRepo.findByProjectIdAndOriginal(projectId, s.original).orElse(null);
            if (existing != null && existing.getStatus() == RenameStatus.APPLIED) {
                // Don't override an already-accepted rename.
                continue;
            }
            ProjectRename row = existing != null ? existing : new ProjectRename();
            if (existing == null) {
                row.setProject(project);
                row.setOriginal(s.original);
                row.setStatus(RenameStatus.SUGGESTED);
            }
            row.setSuggested(s.suggested);
            row.setScope(s.scope);
            row.setConfidence(s.confidence);
            row.setSourcePath(req.filePath());
            row.setRationale(s.rationale);
            savedDtos.add(RenameDto.from(renameRepo.save(row)));
        }
        return new SuggestRenamesResponse(savedDtos, chunks.size(), totalInput, totalOutput, modelUsed);
    }

    /**
     * Upsert one rename and immediately mark it APPLIED. Used by the OpenBin
     * function-rename UI — the user types a new name and expects it to take
     * effect at once, with no SUGGESTED middle state to flip through.
     * Re-renaming the same {@code original} replaces the suggested name
     * (handy for "I made a typo, try again").
     */
    @Transactional
    public RenameDto manualRename(User user, UUID projectId, ManualRenameRequest req) {
        Project project = loadEditableProject(user, projectId);
        ProjectRename row = renameRepo.findByProjectIdAndOriginal(projectId, req.original())
                .orElseGet(() -> {
                    var fresh = new ProjectRename();
                    fresh.setProject(project);
                    fresh.setOriginal(req.original());
                    return fresh;
                });
        row.setSuggested(req.suggested());
        row.setScope(req.scope());
        row.setStatus(RenameStatus.APPLIED);
        if (row.getConfidence() == null) row.setConfidence("manual");
        invalidateSymbolIndex(project);
        return RenameDto.from(renameRepo.save(row));
    }

    /**
     * BIN-specific suggest path. The user clicks "✨ Suggest" while viewing
     * one function; we send that function's signature + decompiled C to the
     * LLM and ask for renames for both the function itself and its locals/
     * parameters. Persisted as SUGGESTED rows with
     * {@code sourcePath="function:<originalName>"} so the per-function
     * variable rename applier (see {@link #applyMapToBinaryAnalysisJson})
     * knows which function body each variable rename belongs to.
     *
     * <p>Resolves through {@link #resolveOriginal} first so the same call
     * works whether the frontend sent the original {@code FUN_004010e0}
     * name or a previously-applied user rename like {@code parseHeader}.
     */
    @Transactional
    public SuggestRenamesResponse suggestForFunction(
            User user, UUID projectId, SuggestFunctionRenamesRequest req
    ) {
        Project project = loadEditableProjectReady(user, projectId);
        if (project.getKind() != ProjectKind.BIN) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST,
                    "suggest-function is only available for binary projects");
        }
        LlmCredential cred = loadCredential(user, req.credentialId());

        String originalName = resolveOriginal(projectId, req.functionName());
        String json = analysisLoader.load(project);
        if (json == null || json.isBlank()) {
            throw new ResponseStatusException(HttpStatus.CONFLICT, "binary analysis not available");
        }

        String signature = "";
        String decompiled = "";
        try {
            JsonNode root = mapper.readTree(json);
            JsonNode functions = root.path("functions");
            if (functions.isArray()) {
                for (JsonNode fn : functions) {
                    if (originalName.equals(fn.path("name").asString(""))) {
                        signature = fn.path("signature").asString("");
                        decompiled = fn.path("decompiled").asString("");
                        break;
                    }
                }
            }
        } catch (RuntimeException e) {
            // Jackson 3 throws unchecked JacksonException (a RuntimeException
            // subclass) when the JSON is malformed — readTree no longer
            // declares IOException, so we widen the catch here.
            throw new ResponseStatusException(HttpStatus.INTERNAL_SERVER_ERROR,
                    "binary analysis JSON corrupt: " + e.getMessage());
        }
        if (decompiled.isBlank()) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST,
                    "function '" + originalName + "' has no decompiled body to analyze "
                            + "(external/thunk, or function not found)");
        }

        String userPrompt = "Function: " + originalName + "\n\n"
                + "Signature: " + signature + "\n\n"
                + "Decompiled C:\n```c\n" + decompiled + "\n```\n";

        var result = invoker.complete(
                user, projectId, "rename_function",
                cred, SYSTEM_PROMPT_BIN_FUNCTION, userPrompt, MAX_TOKENS, req.model());
        markCredentialUsed(cred);

        List<RawSuggestion> raw = parseSuggestionsBin(result.text());
        // Function-scope suggestions where original doesn't match the active
        // function are dropped — the model shouldn't be retitling something
        // it wasn't shown. Variable scopes are kept as-is.
        Map<String, RawSuggestion> deduped = new LinkedHashMap<>();
        for (RawSuggestion s : raw) {
            if ("function".equals(s.scope) && !s.original.equals(originalName)) continue;
            deduped.putIfAbsent(s.original, s);
        }

        List<RenameDto> saved = new ArrayList<>();
        for (RawSuggestion s : deduped.values()) {
            ProjectRename existing = renameRepo.findByProjectIdAndOriginal(projectId, s.original).orElse(null);
            if (existing != null && existing.getStatus() == RenameStatus.APPLIED) continue;
            ProjectRename row = existing != null ? existing : new ProjectRename();
            if (existing == null) {
                row.setProject(project);
                row.setOriginal(s.original);
                row.setStatus(RenameStatus.SUGGESTED);
            }
            row.setSuggested(s.suggested);
            row.setScope(s.scope);
            row.setConfidence(s.confidence);
            // Variable renames need their owning function tracked so they're
            // applied per-body, not project-wide. Function-scope rows also
            // get the tag for symmetry / for the UI to group suggestions by
            // function.
            row.setSourcePath("function:" + originalName);
            row.setRationale(s.rationale);
            saved.add(RenameDto.from(renameRepo.save(row)));
        }
        return new SuggestRenamesResponse(saved, 1, result.inputTokens(), result.outputTokens(), result.model());
    }

    /**
     * Parse a BIN suggest response. Identical shape to {@link #parseSuggestions}
     * but with a different allowed scope set — "function" and "variable"
     * are valid here; "class"/"method"/"field" are not.
     */
    private List<RawSuggestion> parseSuggestionsBin(String raw) {
        if (raw == null || raw.isBlank()) return List.of();
        String json = extractJsonObject(raw);
        if (json == null) {
            log.warn("rename-bin: no JSON object found in model output (head: {})",
                    raw.substring(0, Math.min(200, raw.length())));
            return List.of();
        }
        try {
            JsonNode root = mapper.readTree(json);
            JsonNode arr = root.path("renames");
            if (!arr.isArray()) return List.of();
            List<RawSuggestion> out = new ArrayList<>();
            for (JsonNode n : arr) {
                String original = n.path("original").asString("");
                String suggested = n.path("suggested").asString("");
                String scope = n.path("scope").asString("");
                String confidence = n.path("confidence").asString("medium");
                String rationale = n.path("rationale").asString("");
                if (original.isBlank() || suggested.isBlank() || original.equals(suggested)) continue;
                if (!List.of("function", "variable").contains(scope)) continue;
                if (!List.of("high", "medium").contains(confidence)) continue;
                out.add(new RawSuggestion(original, suggested, scope, confidence, rationale));
            }
            return out;
        } catch (Exception e) {
            log.warn("rename-bin: failed to parse JSON ({}): head={}", e.toString(),
                    json.substring(0, Math.min(200, json.length())));
            return List.of();
        }
    }

    @Transactional
    public List<RenameDto> apply(User user, UUID projectId, ApplyRenamesRequest req) {
        Project project = loadEditableProject(user, projectId);
        List<RenameDto> applied = new ArrayList<>();
        for (String original : req.originals()) {
            ProjectRename row = renameRepo.findByProjectIdAndOriginal(projectId, original).orElse(null);
            if (row == null) continue;
            row.setStatus(RenameStatus.APPLIED);
            applied.add(RenameDto.from(renameRepo.save(row)));
        }
        if (!applied.isEmpty()) invalidateSymbolIndex(project);
        return applied;
    }

    @Transactional
    public void unapply(User user, UUID projectId, String original) {
        Project project = loadEditableProject(user, projectId);
        renameRepo.findByProjectIdAndOriginal(projectId, original).ifPresent(row -> {
            renameRepo.delete(row);
            invalidateSymbolIndex(project);
        });
    }

    /**
     * Files on disk keep their original identifiers; the symbol index, however,
     * extracts what {@link #applyMapToContent} produces (the renamed view the
     * user actually sees). So any change to the active rename set makes the
     * cached index lie. Null it out and let {@code SymbolService.getOrBuild}
     * rebuild lazily on the next query.
     */
    private void invalidateSymbolIndex(Project project) {
        if (project.getSymbolIndexJson() == null) return;
        project.setSymbolIndexJson(null);
        projectRepo.save(project);
    }

    /**
     * Rewrite all APPLIED-rename originals in {@code content} with their suggested
     * names using word-boundary regex. Called by ProjectService.readFile so every
     * file the API serves (and every chunk the AI sees on /ask + /analyze) reflects
     * the user's accepted renames.
     *
     * <p>Caveat: word-boundary substitution is not AST-aware. A class named {@code a}
     * gets renamed wherever {@code \ba\b} matches, which can hit unrelated variables.
     * The review-and-apply UX is the safety net; user can unapply if a rename
     * causes problems.
     */
    /**
     * Active rename map for a project: original → suggested. Returned in
     * deterministic key order so callers building inverse maps don't have to
     * worry about ambiguous collisions across calls. Used by the usage-index
     * query path to translate between pre-index (raw) names and post-rename
     * (displayed) names without forcing an index rebuild on every accepted rename.
     */
    @Transactional(readOnly = true)
    public java.util.Map<String, String> activeRenameMap(UUID projectId) {
        List<ProjectRename> applied = renameRepo.findByProjectIdAndStatus(projectId, RenameStatus.APPLIED);
        java.util.Map<String, String> out = new java.util.LinkedHashMap<>(applied.size());
        for (ProjectRename r : applied) {
            out.put(r.getOriginal(), r.getSuggested());
        }
        return out;
    }

    /**
     * Inverse lookup: given a name the frontend sent (which may be a renamed
     * "suggested" value the user is staring at), return the underlying
     * original from the worker output. Returns {@code candidate} unchanged
     * when no APPLIED rename maps to it — so callers can always feed the
     * result into their existing lookup paths.
     *
     * <p>If two renames collide on the same suggested name (e.g. two
     * functions both renamed to "init") the first match wins. The rename
     * UI doesn't currently prevent collisions; we could add a unique-on-
     * suggested constraint later if it bites.
     */
    @Transactional(readOnly = true)
    public String resolveOriginal(UUID projectId, String candidate) {
        if (candidate == null || candidate.isEmpty()) return candidate;
        for (ProjectRename r : renameRepo.findByProjectIdAndStatus(projectId, RenameStatus.APPLIED)) {
            if (candidate.equals(r.getSuggested())) return r.getOriginal();
        }
        return candidate;
    }

    @Transactional(readOnly = true)
    public String applyMapToContent(UUID projectId, String content) {
        List<ProjectRename> applied = renameRepo.findByProjectIdAndStatus(projectId, RenameStatus.APPLIED);
        if (applied.isEmpty()) return content;
        String result = content;
        for (ProjectRename r : applied) {
            String pattern = "\\b" + Pattern.quote(r.getOriginal()) + "\\b";
            result = result.replaceAll(pattern, Matcher.quoteReplacement(r.getSuggested()));
        }
        return result;
    }

    /**
     * BIN-aware applier for the binary analysis JSON. Function-scope renames
     * (and any other non-variable scope) get the simple project-wide
     * word-boundary substitution, same as {@link #applyMapToContent}. But
     * variable-scope renames are stored against a specific function body —
     * applying them globally would mass-rewrite identical placeholder names
     * (Ghidra reuses {@code uVar1}, {@code param_1}, etc. across every
     * function). So for variables we parse the JSON, locate each owning
     * function's {@code decompiled} + {@code disassembly[].text} + {@code
     * signature} + {@code vars[].name} fields, and rewrite only those.
     *
     * <p>Order matters: variables are applied to the original-named function
     * bodies first, then the global pass rewrites the function names
     * themselves. If we ran the global pass first, the function names in
     * the JSON would no longer match the {@code function:<originalName>}
     * sourcePath tags on the variable renames.
     */
    @Transactional(readOnly = true)
    public String applyMapToBinaryAnalysisJson(UUID projectId, String json) {
        List<ProjectRename> applied = renameRepo.findByProjectIdAndStatus(projectId, RenameStatus.APPLIED);
        if (applied.isEmpty()) return json;

        List<ProjectRename> globalRenames = new ArrayList<>();
        Map<String, List<ProjectRename>> varsByFn = new HashMap<>();
        for (ProjectRename r : applied) {
            if ("variable".equals(r.getScope())) {
                String src = r.getSourcePath();
                if (src != null && src.startsWith("function:")) {
                    varsByFn.computeIfAbsent(src.substring("function:".length()),
                            k -> new ArrayList<>()).add(r);
                }
                // Variable renames without a function: sourcePath are skipped —
                // they have no scope, so applying them would be unsafe.
            } else {
                globalRenames.add(r);
            }
        }

        String result = json;
        if (!varsByFn.isEmpty()) {
            try {
                JsonNode root = mapper.readTree(json);
                JsonNode functions = root.path("functions");
                if (functions instanceof ArrayNode arr) {
                    for (JsonNode fnNode : arr) {
                        if (!(fnNode instanceof ObjectNode fn)) continue;
                        String name = fn.path("name").asString("");
                        List<ProjectRename> vars = varsByFn.get(name);
                        if (vars == null || vars.isEmpty()) continue;

                        String decompiled = fn.path("decompiled").asString(null);
                        if (decompiled != null) {
                            fn.put("decompiled", applyOne(decompiled, vars));
                        }
                        String signature = fn.path("signature").asString(null);
                        if (signature != null) {
                            fn.put("signature", applyOne(signature, vars));
                        }
                        JsonNode disasm = fn.path("disassembly");
                        if (disasm instanceof ArrayNode disasmArr) {
                            for (JsonNode lineNode : disasmArr) {
                                if (!(lineNode instanceof ObjectNode line)) continue;
                                String text = line.path("text").asString(null);
                                if (text != null) line.put("text", applyOne(text, vars));
                            }
                        }
                        // Cross-highlight var map: rewrite each entry's `name`
                        // so the frontend's name-keyed variable highlight still
                        // resolves after a rename (the addrs are immutable).
                        JsonNode varsNode = fn.path("vars");
                        if (varsNode instanceof ArrayNode varsArr) {
                            for (JsonNode vNode : varsArr) {
                                if (!(vNode instanceof ObjectNode v)) continue;
                                String vname = v.path("name").asString(null);
                                if (vname != null) v.put("name", applyOne(vname, vars));
                            }
                        }
                    }
                }
                result = mapper.writeValueAsString(root);
            } catch (Exception e) {
                log.warn("variable-rename pass failed on project {} ({}); falling back to global-only",
                        projectId, e.toString());
            }
        }

        for (ProjectRename r : globalRenames) {
            String pattern = "\\b" + Pattern.quote(r.getOriginal()) + "\\b";
            result = result.replaceAll(pattern, Matcher.quoteReplacement(r.getSuggested()));
        }
        return result;
    }

    private static String applyOne(String text, List<ProjectRename> renames) {
        String result = text;
        for (ProjectRename r : renames) {
            String pattern = "\\b" + Pattern.quote(r.getOriginal()) + "\\b";
            result = result.replaceAll(pattern, Matcher.quoteReplacement(r.getSuggested()));
        }
        return result;
    }

    // -------------------------------------------------------------------
    // Helpers
    // -------------------------------------------------------------------

    /** Raw file content (NO rename map applied — that would defeat the suggest path). */
    private String readRawFile(User user, UUID projectId, String relPath) {
        Path root = storage.srcDir(user.getId(), projectId).normalize();
        Path resolved = root.resolve(relPath).normalize();
        if (!resolved.startsWith(root)) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "path escapes project root");
        }
        if (!Files.isRegularFile(resolved)) {
            throw new ResponseStatusException(HttpStatus.NOT_FOUND, "not a regular file");
        }
        try {
            long size = Files.size(resolved);
            if (size > MAX_FILE_BYTES) {
                throw new ResponseStatusException(HttpStatus.CONTENT_TOO_LARGE,
                        "File is " + size + " bytes — over the 200KB rename cap. Split the work or pick a smaller file.");
            }
            try (InputStream in = Files.newInputStream(resolved)) {
                return new String(in.readAllBytes(), StandardCharsets.UTF_8);
            }
        } catch (IOException e) {
            throw new ResponseStatusException(HttpStatus.INTERNAL_SERVER_ERROR, "read failed: " + e.getMessage());
        }
    }

    /** Splits content into ~CHUNK_LINES-line windows with OVERLAP_LINES overlap so identifier context doesn't get sliced. */
    private List<String> chunkContent(String content) {
        String[] lines = content.split("\n", -1);
        if (lines.length <= LARGE_FILE_LINES) return List.of(content);
        List<String> chunks = new ArrayList<>();
        int i = 0;
        while (i < lines.length) {
            int end = Math.min(i + CHUNK_LINES, lines.length);
            chunks.add(String.join("\n", Arrays.copyOfRange(lines, i, end)));
            if (end >= lines.length) break;
            i += (CHUNK_LINES - OVERLAP_LINES);
        }
        return chunks;
    }

    private String buildUserPrompt(String chunk, String filePath, int chunkIdx, int totalChunks) {
        StringBuilder sb = new StringBuilder();
        sb.append("File: ").append(filePath);
        if (totalChunks > 1) {
            sb.append(" (chunk ").append(chunkIdx + 1).append("/").append(totalChunks).append(")");
        }
        sb.append("\n\n```java\n").append(chunk).append("\n```\n");
        return sb.toString();
    }

    /** Best-effort JSON extraction — accepts raw JSON, markdown fences, or trailing prose. */
    private List<RawSuggestion> parseSuggestions(String raw) {
        if (raw == null || raw.isBlank()) return List.of();
        String json = extractJsonObject(raw);
        if (json == null) {
            log.warn("rename: no JSON object found in model output (head: {})", raw.substring(0, Math.min(200, raw.length())));
            return List.of();
        }
        try {
            JsonNode root = mapper.readTree(json);
            JsonNode arr = root.path("renames");
            if (!arr.isArray()) return List.of();
            List<RawSuggestion> out = new ArrayList<>();
            for (JsonNode n : arr) {
                String original = n.path("original").asString("");
                String suggested = n.path("suggested").asString("");
                String scope = n.path("scope").asString("");
                String confidence = n.path("confidence").asString("medium");
                String rationale = n.path("rationale").asString("");
                if (original.isBlank() || suggested.isBlank() || original.equals(suggested)) continue;
                if (!List.of("class", "method", "field").contains(scope)) continue;
                if (!List.of("high", "medium").contains(confidence)) continue;
                out.add(new RawSuggestion(original, suggested, scope, confidence, rationale));
            }
            return out;
        } catch (Exception e) {
            log.warn("rename: failed to parse JSON ({}): head={}", e.toString(),
                    json.substring(0, Math.min(200, json.length())));
            return List.of();
        }
    }

    /** Pull the first balanced {...} block out of an arbitrary string. */
    private static String extractJsonObject(String text) {
        int start = text.indexOf('{');
        if (start < 0) return null;
        int depth = 0;
        for (int i = start; i < text.length(); i++) {
            char c = text.charAt(i);
            if (c == '{') depth++;
            else if (c == '}') {
                depth--;
                if (depth == 0) return text.substring(start, i + 1);
            }
        }
        return null;
    }

    /**
     * Owner OR EDITOR; rename mutations are edit-level. Wraps
     * {@link ProjectAccessGuard#requireEdit} so the existing call
     * sites stay structurally similar to the pre-collab code.
     */
    private Project loadEditableProject(User user, UUID projectId) {
        return guard.requireEdit(user, projectId);
    }

    /**
     * Same as {@link #loadEditableProject} but also asserts
     * {@code status == READY}. Used by the AI-suggest paths where
     * mid-decompile invocation has no useful project state to read.
     */
    private Project loadEditableProjectReady(User user, UUID projectId) {
        Project p = loadEditableProject(user, projectId);
        if (p.getStatus() != ProjectStatus.READY) {
            throw new ResponseStatusException(HttpStatus.CONFLICT,
                    "project is not READY (current status: " + p.getStatus() + ")");
        }
        return p;
    }

    private LlmCredential loadCredential(User user, UUID credentialId) {
        return credRepo.findByIdAndUserId(credentialId, user.getId())
                .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND, "credential not found"));
    }

    private void markCredentialUsed(LlmCredential cred) {
        cred.setLastUsedAt(Instant.now());
        credRepo.save(cred);
    }

    private record RawSuggestion(String original, String suggested, String scope, String confidence, String rationale) {}
}
