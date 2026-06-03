package ai.openapk.core.deobf;

import ai.openapk.core.analysis.LlmInvoker;
import ai.openapk.core.analysis.LlmInvoker.CompletionResult;
import ai.openapk.core.auth.User;
import ai.openapk.core.credentials.LlmCredential;
import ai.openapk.core.credentials.LlmCredentialRepository;
import ai.openapk.core.deobf.dto.DeobfuscateFunctionRequest;
import ai.openapk.core.deobf.dto.FunctionDeobfuscationResponse;
import ai.openapk.core.projects.Project;
import ai.openapk.core.projects.ProjectKind;
import ai.openapk.core.projects.ProjectRepository;
import ai.openapk.core.renames.RenameService;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.server.ResponseStatusException;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;

import java.time.Instant;
import java.util.List;
import java.util.UUID;

/**
 * Generates AI-cleaned versions of obfuscated decompiled functions —
 * unwinds control-flow flattening, opaque predicates, dispatcher state
 * machines, etc. into plain C that does the same thing.
 *
 * <p>Storage is keyed by pre-rename function name; the rest of the
 * inspector (chain, xref, network, click-to-jump) continues to operate on
 * the original {@code decompiled} string from the analysis JSON, so this
 * service can be enabled/disabled per-function without breaking anything
 * else. The frontend renders the deobf string as a third view alongside
 * pseudocode + disassembly.
 */
@Service
public class DeobfuscationService {

    private static final Logger log = LoggerFactory.getLogger(DeobfuscationService.class);

    /** Cap output tokens — typical cleaned function is much shorter than a
     *  4k bound, but the model occasionally pads explanation. */
    private static final int MAX_TOKENS = 6000;

    private static final String SYSTEM_PROMPT = """
            You are a reverse engineer. The C below was produced by the Ghidra decompiler from a \
            binary whose original source MAY have been obfuscated — control-flow flattening, opaque \
            predicates, dispatcher state machines, dead code, junk arithmetic, ESI/EDI register \
            tricks. Your job is to produce a CLEANED, READABLE C version that does exactly the same \
            thing.

            Output format — STRICT:
            - The VERY FIRST LINE must be a verdict comment of this exact form:
              `// AI-deobf: <one-line verdict>`
              Examples:
                `// AI-deobf: dispatcher state machine unwound (5 states, 1 abort path)`
                `// AI-deobf: opaque predicates inlined, 2 dead branches removed`
                `// AI-deobf: no obfuscation detected — output unchanged from input`
                `// AI-deobf: light cleanup only (formatting + variable renames)`
              The frontend parses this line to show the user what changed.
            - After the verdict line, output ONLY the cleaned C function — no further commentary \
              outside the code, no markdown fences, no language tags. Inline comments inside the \
              function are fine.

            Rules:
            1. Preserve all observable behavior. Don't simplify away side effects, function calls, \
               or memory writes.
            2. Strip dispatcher state machines: the magic-constant switch loops (e.g. \
               `if (iVar1 == 0x68970b2b) { iVar1 = -0x66c69310; }`) are NOT real logic — they encode \
               control flow. Resolve the state graph and emit plain if/while/for.
            3. Inline opaque predicates (always-true / always-false branches) and remove the dead \
               branch.
            4. KEEP the original function name exactly as given (e.g. FUN_0001f9d0). KEEP all called \
               function names verbatim (FUN_xxxxx, imports like printf, library calls). The rest of \
               the tooling indexes against those names — renaming them here would break call-chain \
               navigation.
            5. Parameter names + the function signature should match the input. Local variables can \
               be renamed if it makes the cleaned form clearer.
            6. Drop sections that become genuinely unreachable after un-flattening.
            7. If you can't confidently un-flatten a section, leave it as-is wrapped in a clear \
               `/* AI-deobf: unclear */ ... /* end unclear */` comment, rather than guessing.
            8. If the input does NOT appear obfuscated (already-clean Ghidra output), return it \
               essentially unchanged — formatting touch-ups only — and use the \
               "no obfuscation detected" verdict.
            """;

    private final ProjectRepository projectRepo;
    private final FunctionDeobfuscationRepository deobfRepo;
    private final LlmCredentialRepository credRepo;
    private final LlmInvoker invoker;
    private final RenameService renameService;
    private final ObjectMapper mapper;

    public DeobfuscationService(
            ProjectRepository projectRepo,
            FunctionDeobfuscationRepository deobfRepo,
            LlmCredentialRepository credRepo,
            LlmInvoker invoker,
            RenameService renameService,
            ObjectMapper mapper
    ) {
        this.projectRepo = projectRepo;
        this.deobfRepo = deobfRepo;
        this.credRepo = credRepo;
        this.invoker = invoker;
        this.renameService = renameService;
        this.mapper = mapper;
    }

    @Transactional(readOnly = true)
    public List<FunctionDeobfuscationResponse> list(User user, UUID projectId) {
        ensureOwnedBin(user, projectId);
        return deobfRepo.findByProjectId(projectId).stream()
                .map(FunctionDeobfuscationResponse::from)
                .toList();
    }

    @Transactional
    public FunctionDeobfuscationResponse generate(User user, UUID projectId, DeobfuscateFunctionRequest req) {
        Project project = ensureOwnedBin(user, projectId);
        LlmCredential cred = credRepo.findByIdAndUserId(req.credentialId(), user.getId())
                .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND, "credential not found"));

        String originalName = renameService.resolveOriginal(projectId, req.functionName());
        String decompiled = loadDecompiled(project, originalName);
        if (decompiled.isBlank()) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST,
                    "function '" + req.functionName() + "' has no decompiled body to deobfuscate");
        }

        String userPrompt = "Function: " + originalName + "\n\n```c\n" + decompiled + "\n```\n";
        CompletionResult result;
        try {
            result = invoker.complete(
                    user, projectId, "deobfuscate_function",
                    cred, SYSTEM_PROMPT, userPrompt, MAX_TOKENS, req.model());
        } catch (Exception e) {
            throw new ResponseStatusException(HttpStatus.BAD_GATEWAY, "LLM call failed: " + e.getMessage(), e);
        }

        String cleaned = stripCodeFences(result.text());
        if (cleaned.isBlank()) {
            log.warn("deobfuscate: model emitted empty body. head: {}",
                    result.text().substring(0, Math.min(200, result.text().length())));
            throw new ResponseStatusException(HttpStatus.BAD_GATEWAY,
                    "Model did not return a usable deobfuscation. Try again or pick a different model.");
        }

        FunctionDeobfuscation row = deobfRepo
                .findByProjectIdAndOriginalName(projectId, originalName)
                .orElseGet(FunctionDeobfuscation::new);
        if (row.getProject() == null) row.setProject(project);
        row.setOriginalName(originalName);
        row.setDeobfuscated(cleaned);
        row.setExplanation(null);
        row.setModel(result.model());
        row.setInputTokens(result.inputTokens());
        row.setOutputTokens(result.outputTokens());
        // Bump createdAt on regenerate so the UI surfaces the freshness.
        row.setCreatedAt(Instant.now());

        log.info("deobfuscate: project={} fn={} in={} out={} model={}",
                projectId, originalName, result.inputTokens(), result.outputTokens(), result.model());

        return FunctionDeobfuscationResponse.from(deobfRepo.save(row));
    }

    @Transactional
    public void delete(User user, UUID projectId, String functionName) {
        ensureOwnedBin(user, projectId);
        String originalName = renameService.resolveOriginal(projectId, functionName);
        deobfRepo.deleteByProjectIdAndOriginalName(projectId, originalName);
    }

    private Project ensureOwnedBin(User user, UUID projectId) {
        Project project = projectRepo.findByIdAndUserId(projectId, user.getId())
                .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND, "project not found"));
        if (project.getKind() != ProjectKind.BIN) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST,
                    "deobfuscation is only available for binary projects");
        }
        return project;
    }

    /**
     * Pull the decompiled body for {@code originalName} out of the
     * project's binary_analysis_jsonb. Returns empty string if the
     * function isn't found, is an external, or is a thunk — caller treats
     * empty as a 400 "no body to deobfuscate".
     */
    private String loadDecompiled(Project project, String originalName) {
        String json = project.getBinaryAnalysisJson();
        if (json == null || json.isBlank()) {
            throw new ResponseStatusException(HttpStatus.CONFLICT, "binary analysis not available");
        }
        try {
            JsonNode root = mapper.readTree(json);
            JsonNode functions = root.path("functions");
            if (!functions.isArray()) return "";
            for (JsonNode fn : functions) {
                if (!originalName.equals(fn.path("name").asString(""))) continue;
                if (fn.path("external").asBoolean(false)) return "";
                if (fn.path("thunk").asBoolean(false)) return "";
                return fn.path("decompiled").asString("");
            }
        } catch (RuntimeException e) {
            throw new ResponseStatusException(HttpStatus.INTERNAL_SERVER_ERROR,
                    "binary analysis JSON corrupt: " + e.getMessage());
        }
        return "";
    }

    /**
     * Some models wrap code in ```c …``` despite the prompt. Strip a single
     * leading + trailing fence pair if present. Untouched output otherwise.
     */
    private static String stripCodeFences(String raw) {
        if (raw == null) return "";
        String t = raw.trim();
        if (!t.startsWith("```")) return t;
        int firstNl = t.indexOf('\n');
        int lastFence = t.lastIndexOf("```");
        if (firstNl < 0 || lastFence <= firstNl) return t;
        return t.substring(firstNl + 1, lastFence).trim();
    }
}
