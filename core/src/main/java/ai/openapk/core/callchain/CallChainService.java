package ai.openapk.core.callchain;

import ai.openapk.core.analysis.LlmInvoker;
import ai.openapk.core.analysis.LlmInvoker.CompletionResult;
import ai.openapk.core.auth.User;
import ai.openapk.core.callchain.dto.CallChain;
import ai.openapk.core.callchain.dto.CallChainNode;
import ai.openapk.core.callchain.dto.ChildrenStats;
import ai.openapk.core.callchain.dto.MethodRef;
import ai.openapk.core.callchain.dto.BinNarration;
import ai.openapk.core.callchain.dto.NarrateBinChainResponse;
import ai.openapk.core.credentials.LlmCredential;
import ai.openapk.core.credentials.LlmCredentialRepository;
import ai.openapk.core.projects.Project;
import ai.openapk.core.projects.ProjectKind;
import ai.openapk.core.projects.ProjectRepository;
import ai.openapk.core.projects.storage.ProjectStorage;
import ai.openapk.core.renames.RenameService;
import ai.openapk.core.symbols.SymbolService;
import ai.openapk.core.symbols.dto.Symbol;
import ai.openapk.core.symbols.dto.SymbolIndex;
import ai.openapk.core.symbols.dto.SymbolKind;
import ai.openapk.core.symbols.dto.SymbolUsage;
import ai.openapk.core.util.SdkPaths;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.server.ResponseStatusException;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;

import java.io.IOException;
import java.nio.charset.MalformedInputException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * Builds a call chain rooted at one method by walking the symbol index
 * upward (who calls this) and downward (what this calls), both bounded by
 * depth + fan-out. Optionally narrates the chain with one LLM call.
 *
 * <p>Limits exist to keep the JSON small and the LLM prompt finite. They
 * are intentionally generous for v1 — researchers can re-build with a
 * shallower depth if the tree is too noisy.</p>
 */
@Service
public class CallChainService {

    private static final Logger log = LoggerFactory.getLogger(CallChainService.class);

    private static final int MAX_DEPTH = 5;
    private static final int MAX_FANOUT = 8;
    private static final int MAX_NARRATE_NODES = 30;
    private static final int NARRATE_BODY_LINES = 50;
    private static final int PREVIEW_LINES = 30;
    private static final int NARRATE_MAX_TOKENS = 4000;

    /** Internal result of one level of walking — the nodes we kept + the truth
     *  about what we saw and what we filtered out. */
    private record LevelResult(List<CallChainNode> nodes, ChildrenStats stats) {}

    // Identifier-followed-by-paren. Filtered against Java keywords + control-flow.
    private static final Pattern CALL_SITE = Pattern.compile(
            "(?<![\\w.])([a-zA-Z_$][a-zA-Z0-9_$]*)\\s*\\("
    );
    private static final Set<String> NON_METHODS = Set.of(
            "if", "for", "while", "return", "new", "switch", "catch", "try", "do",
            "synchronized", "throw", "this", "super", "else", "case", "instanceof",
            "void", "int", "long", "short", "byte", "char", "boolean", "float", "double"
    );

    private final SymbolService symbolService;
    private final ProjectStorage storage;
    private final RenameService renameService;
    private final LlmInvoker invoker;
    private final LlmCredentialRepository credRepo;
    private final ProjectRepository projectRepo;
    private final ObjectMapper mapper;

    public CallChainService(
            SymbolService symbolService,
            ProjectStorage storage,
            RenameService renameService,
            LlmInvoker invoker,
            LlmCredentialRepository credRepo,
            ProjectRepository projectRepo,
            ObjectMapper mapper
    ) {
        this.symbolService = symbolService;
        this.storage = storage;
        this.renameService = renameService;
        this.invoker = invoker;
        this.credRepo = credRepo;
        this.projectRepo = projectRepo;
        this.mapper = mapper;
    }

    @Transactional
    public CallChain build(User user, UUID projectId, String startFile, int startLine, int depth, boolean includeSdks) {
        // Build the lookup index once at the top of the request. Every
        // recursive level reuses it — O(1) name lookups + O(log n) enclosing
        // method lookups instead of the old O(N) linear scans.
        ai.openapk.core.symbols.LookupIndex lookup = symbolService.getOrBuildLookup(user, projectId);
        Path root = storage.srcDir(user.getId(), projectId).normalize();

        Symbol startMethod = findEnclosingMethod(lookup, startFile, startLine, root);
        if (startMethod == null) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST,
                    "No enclosing method found at " + startFile + ":" + startLine
                            + " — make sure you click inside a method body.");
        }

        MethodRef rootRef = methodRefFor(startMethod);
        String rootBody = readPreview(projectId, root, startMethod, PREVIEW_LINES);
        int actualDepth = Math.min(Math.max(depth, 1), MAX_DEPTH);

        Set<String> visitedUp = new HashSet<>();
        visitedUp.add(methodKey(startMethod));
        LevelResult callers = buildUpward(user, projectId, lookup, root,
                startMethod, actualDepth, includeSdks, visitedUp);

        Set<String> visitedDown = new HashSet<>();
        visitedDown.add(methodKey(startMethod));
        LevelResult callees = buildDownward(projectId, lookup, root, startMethod,
                actualDepth, includeSdks, visitedDown);

        return new CallChain(rootRef, rootBody, "",
                callers.nodes(), callees.nodes(),
                callers.stats(), callees.stats());
    }

    /**
     * Walk upward through the symbol index — who calls {@code method}? Cap the
     * returned slate at {@link #MAX_FANOUT} and bias selection toward callers
     * that live in the user's own code (not SDK/framework). The honest counts
     * — raw candidates seen, SDK candidates dropped — are returned in
     * {@link LevelResult#stats()} so the UI can render "8 of 30,000".
     */
    private LevelResult buildUpward(
            User user, UUID projectId, ai.openapk.core.symbols.LookupIndex lookup, Path root,
            Symbol method, int depth, boolean includeSdks, Set<String> visited
    ) {
        if (depth <= 0) return new LevelResult(List.of(), ChildrenStats.EMPTY);
        List<SymbolUsage> usages = symbolService.findUsages(
                user, projectId, method.name(), null, method.file(), method.line(), includeSdks);

        // Resolve each usage to a distinct enclosing-caller symbol, partitioned
        // into project-code vs SDK-code based on file path. We iterate the full
        // usage list to get a true totalCandidates count even when we cap.
        List<CallerCandidate> projectCallers = new ArrayList<>();
        List<CallerCandidate> sdkCallers = new ArrayList<>();
        Set<String> seenAtThisLevel = new HashSet<>();
        for (SymbolUsage u : usages) {
            Symbol enclosing = findEnclosingMethod(lookup, u.file(), u.line(), root);
            if (enclosing == null) continue;
            String key = methodKey(enclosing);
            if (!seenAtThisLevel.add(key)) continue;
            if (visited.contains(key)) continue;
            (SdkPaths.isSdkPath(enclosing.file()) ? sdkCallers : projectCallers)
                    .add(new CallerCandidate(enclosing, u.snippet(), key));
        }

        int totalCandidates = projectCallers.size() + sdkCallers.size();

        // Project callers first; SDK fills the remainder. Honest about how many
        // SDK callers we hid in stats.sdkCandidatesHidden.
        List<CallerCandidate> kept = new ArrayList<>();
        for (CallerCandidate c : projectCallers) {
            if (kept.size() >= MAX_FANOUT) break;
            kept.add(c);
        }
        for (CallerCandidate c : sdkCallers) {
            if (kept.size() >= MAX_FANOUT) break;
            kept.add(c);
        }
        int sdkCandidatesHidden = sdkCallers.size() - Math.max(0, kept.size() - projectCallers.size());

        List<CallChainNode> nodes = new ArrayList<>(kept.size());
        for (CallerCandidate c : kept) {
            visited.add(c.key());
            LevelResult upper = buildUpward(
                    user, projectId, lookup, root, c.symbol(), depth - 1, includeSdks, visited);
            nodes.add(new CallChainNode(
                    methodRefFor(c.symbol()), c.snippet(), "",
                    upper.nodes(), upper.stats()));
        }
        return new LevelResult(nodes, new ChildrenStats(nodes.size(), totalCandidates, sdkCandidatesHidden));
    }

    private record CallerCandidate(Symbol symbol, String snippet, String key) {}

    /**
     * Walk downward through this method's body — what does it call? Bounded
     * by {@link #MAX_FANOUT}. Returns the same stats shape as upward, but
     * {@code sdkCandidatesHidden} is always 0 here — downward already
     * respects the {@code includeSdks} flag via {@link #resolveCallee}.
     */
    private LevelResult buildDownward(
            UUID projectId, ai.openapk.core.symbols.LookupIndex lookup, Path root, Symbol method, int depth, boolean includeSdks, Set<String> visited
    ) {
        if (depth <= 0) return new LevelResult(List.of(), ChildrenStats.EMPTY);
        String body = readBody(projectId, root, method);
        if (body == null) return new LevelResult(List.of(), ChildrenStats.EMPTY);

        // Two passes: first walk every call site to count distinct resolvable
        // callees (the honest total). Second pass builds nodes up to MAX_FANOUT.
        List<CalleeCandidate> candidates = new ArrayList<>();
        Set<String> seenCalleeNames = new HashSet<>();
        String[] lines = body.split("\n", -1);
        for (int i = 0; i < lines.length; i++) {
            Matcher m = CALL_SITE.matcher(lines[i]);
            while (m.find()) {
                String name = m.group(1);
                if (NON_METHODS.contains(name)) continue;
                if (name.equals(method.name())) continue; // skip self-recursion
                if (!seenCalleeNames.add(name)) continue;
                Symbol callee = resolveCallee(lookup, name, includeSdks);
                if (callee == null) continue;
                String key = methodKey(callee);
                if (visited.contains(key)) continue;
                candidates.add(new CalleeCandidate(callee, lines[i].strip(), key));
            }
        }

        int totalCandidates = candidates.size();
        List<CallChainNode> nodes = new ArrayList<>();
        for (CalleeCandidate c : candidates) {
            if (nodes.size() >= MAX_FANOUT) break;
            visited.add(c.key());
            LevelResult lower = buildDownward(
                    projectId, lookup, root, c.symbol(), depth - 1, includeSdks, visited);
            nodes.add(new CallChainNode(
                    methodRefFor(c.symbol()), c.snippet(), "",
                    lower.nodes(), lower.stats()));
        }
        return new LevelResult(nodes, new ChildrenStats(nodes.size(), totalCandidates, 0));
    }

    private record CalleeCandidate(Symbol symbol, String snippet, String key) {}

    /** v1: take the first in-project METHOD or CONSTRUCTOR match by name.
     *  Coarse — homonyms collapse. O(1) lookup via LookupIndex. */
    private Symbol resolveCallee(ai.openapk.core.symbols.LookupIndex lookup, String name, boolean includeSdks) {
        for (Symbol s : lookup.byName(name)) {
            if (s.kind() != SymbolKind.METHOD && s.kind() != SymbolKind.CONSTRUCTOR) continue;
            if (!includeSdks && SdkPaths.isSdkPath(s.file())) continue;
            return s;
        }
        return null;
    }

    /** Find the method (or constructor) whose body encloses file:line. O(log n)
     *  via LookupIndex's per-file TreeMap, plus an end-of-body check that needs
     *  disk access (so we keep it here, not in LookupIndex). */
    private Symbol findEnclosingMethod(ai.openapk.core.symbols.LookupIndex lookup, String file, int line, Path root) {
        Symbol best = lookup.enclosingMethod(file, line);
        if (best == null) return null;
        int end = computeEndLine(root, best);
        if (end < line) return null;
        return best;
    }

    private int computeEndLine(Path root, Symbol method) {
        Path file = root.resolve(method.file());
        try {
            List<String> lines = Files.readAllLines(file, StandardCharsets.UTF_8);
            int depth = 0;
            boolean started = false;
            for (int i = method.line() - 1; i < lines.size(); i++) {
                String line = lines.get(i);
                for (int c = 0; c < line.length(); c++) {
                    char ch = line.charAt(c);
                    if (ch == '{') { depth++; started = true; }
                    else if (ch == '}') { depth--; if (started && depth <= 0) return i + 1; }
                }
            }
        } catch (MalformedInputException ignored) {
        } catch (IOException e) {
            log.debug("computeEndLine read failure {}: {}", file, e.toString());
        }
        return Integer.MAX_VALUE;
    }

    private String readBody(UUID projectId, Path root, Symbol method) {
        Path file = root.resolve(method.file());
        try {
            String content = renameService.applyMapToContent(projectId,
                    Files.readString(file, StandardCharsets.UTF_8));
            List<String> lines = List.of(content.split("\n", -1));
            int end = Math.min(computeEndLine(root, method), lines.size());
            int from = Math.max(0, method.line() - 1);
            if (end <= from) return "";
            return String.join("\n", lines.subList(from, end));
        } catch (MalformedInputException e) {
            return "";
        } catch (IOException e) {
            log.debug("readBody failure {}: {}", file, e.toString());
            return null;
        }
    }

    private String readPreview(UUID projectId, Path root, Symbol method, int maxLines) {
        Path file = root.resolve(method.file());
        try {
            String content = renameService.applyMapToContent(projectId,
                    Files.readString(file, StandardCharsets.UTF_8));
            String[] lines = content.split("\n", -1);
            int from = Math.max(0, method.line() - 1);
            int to = Math.min(from + maxLines, lines.length);
            if (to <= from) return "";
            return String.join("\n", java.util.Arrays.asList(lines).subList(from, to));
        } catch (IOException e) {
            return "";
        }
    }

    // -------------------------------------------------------------------
    // Narration
    // -------------------------------------------------------------------

    /**
     * Sends every method in the chain (up to MAX_NARRATE_NODES) to the LLM in a
     * single call, asks for one-sentence summaries keyed by file:line, then
     * walks the chain a second time to attach each summary. One LLM call per
     * narrate request — token cost roughly proportional to chain size.
     */
    @Transactional(readOnly = true)
    public CallChain narrate(User user, UUID projectId, CallChain chain, UUID credentialId, String model) {
        LlmCredential cred = credRepo.findByIdAndUserId(credentialId, user.getId())
                .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND, "credential not found"));
        Path root = storage.srcDir(user.getId(), projectId).normalize();

        // Collect every distinct method in the chain (root + walk both trees).
        LinkedHashMap<String, MethodRef> order = new LinkedHashMap<>();
        order.put(refKey(chain.root()), chain.root());
        for (CallChainNode n : chain.callers()) collectRefs(n, order);
        for (CallChainNode n : chain.callees()) collectRefs(n, order);

        List<MethodRef> refs = new ArrayList<>(order.values());
        if (refs.size() > MAX_NARRATE_NODES) refs = refs.subList(0, MAX_NARRATE_NODES);

        StringBuilder prompt = new StringBuilder();
        prompt.append("Walk through this call chain. For each method below, write one short sentence ")
                .append("describing what it does and why it matters in the chain. Be terse, technical, no fluff. ")
                .append("Return JSON only — no markdown — with this exact shape:\n\n")
                .append("{\"summaries\": [{\"key\": \"path/to/File.java:LINE\", \"summary\": \"...\"}, ...]}\n\n")
                .append("The \"key\" MUST match the (file:line) header exactly. Skip methods whose code is missing.\n\n");

        for (MethodRef ref : refs) {
            String body = readBodyByRef(projectId, root, ref);
            prompt.append("=== ").append(ref.file()).append(":").append(ref.line()).append(" — ")
                    .append(ref.className()).append(".").append(ref.name()).append(ref.signature()).append(" ===\n")
                    .append(truncateBody(body, NARRATE_BODY_LINES))
                    .append("\n\n");
        }

        CompletionResult result;
        try {
            result = invoker.complete(
                    user, projectId, "callchain_narrate",
                    cred,
                    "You are a malware reverse engineer summarising decompiled Java for a teammate.",
                    prompt.toString(),
                    NARRATE_MAX_TOKENS,
                    model
            );
        } catch (Exception e) {
            throw new ResponseStatusException(HttpStatus.BAD_GATEWAY, "LLM call failed: " + e.getMessage(), e);
        }

        Map<String, String> byKey = parseSummaries(result.text());

        String rootNarr = byKey.getOrDefault(refKey(chain.root()), "");
        List<CallChainNode> newCallers = chain.callers().stream().map(n -> withNarration(n, byKey)).toList();
        List<CallChainNode> newCallees = chain.callees().stream().map(n -> withNarration(n, byKey)).toList();
        return new CallChain(
                chain.root(), chain.rootBody(), rootNarr,
                newCallers, newCallees,
                chain.callersStats(), chain.calleesStats());
    }

    /**
     * BIN equivalent of {@link #narrate}. The openbin chain is built client-
     * side from the analysis JSON's xref table, so we don't need a chain
     * structure from the frontend — just the flat list of function names
     * the user has open. Reads each function's signature + decompiled body
     * from the project's binary_analysis_jsonb, inverse-resolves through
     * RenameService so user-renamed names work, and sends a single LLM
     * call asking for per-function summaries keyed by name.
     */
    @Transactional(readOnly = true)
    public NarrateBinChainResponse narrateBin(
            User user, UUID projectId, List<String> functionNames, UUID credentialId, String model
    ) {
        Project project = projectRepo.findByIdAndUserId(projectId, user.getId())
                .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND, "project not found"));
        if (project.getKind() != ProjectKind.BIN) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST,
                    "narrate-bin is only available for binary projects");
        }
        LlmCredential cred = credRepo.findByIdAndUserId(credentialId, user.getId())
                .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND, "credential not found"));

        String json = project.getBinaryAnalysisJson();
        if (json == null || json.isBlank()) {
            throw new ResponseStatusException(HttpStatus.CONFLICT, "binary analysis not available");
        }

        // Cap node count so a deep+wide chain can't blow out the prompt
        // budget. Same MAX_NARRATE_NODES as the APK narrate path; matches
        // the @Size(max = 50) on the request DTO.
        List<String> names = functionNames.size() > MAX_NARRATE_NODES
                ? functionNames.subList(0, MAX_NARRATE_NODES)
                : functionNames;

        // Pull (originalName -> body) once per request so the prompt builder
        // can skip externals/thunks cleanly. We key by the original name so
        // the JSON response can come back tagged with whichever name the
        // user passed in (renamed-or-original); RenameService.resolveOriginal
        // gives us the inverse.
        record FnEntry(String displayName, String originalName, String signature, String body) {}
        List<FnEntry> entries = new ArrayList<>(names.size());
        try {
            JsonNode root = mapper.readTree(json);
            JsonNode functions = root.path("functions");
            if (functions.isArray()) {
                for (String displayName : names) {
                    String orig = renameService.resolveOriginal(projectId, displayName);
                    for (JsonNode fn : functions) {
                        if (!orig.equals(fn.path("name").asString(""))) continue;
                        // Externals and thunks have no body to narrate — drop
                        // them rather than asking the model to invent one.
                        if (fn.path("external").asBoolean(false)) break;
                        if (fn.path("thunk").asBoolean(false)) break;
                        String body = fn.path("decompiled").asString("");
                        if (body.isBlank()) break;
                        String sig = fn.path("signature").asString("");
                        entries.add(new FnEntry(displayName, orig, sig, body));
                        break;
                    }
                }
            }
        } catch (RuntimeException e) {
            throw new ResponseStatusException(HttpStatus.INTERNAL_SERVER_ERROR,
                    "binary analysis JSON corrupt: " + e.getMessage());
        }
        if (entries.isEmpty()) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST,
                    "no function bodies available to narrate — chain may be all externals/thunks");
        }

        StringBuilder prompt = new StringBuilder();
        prompt.append("Walk through this call chain. For each function below, write one short sentence ")
                .append("describing what it does and why it matters in the chain. Be terse, technical, no fluff. ")
                .append("Return JSON only — no markdown — with this exact shape:\n\n")
                .append("{\"summaries\": [{\"key\": \"<function name>\", \"summary\": \"...\"}, ...]}\n\n")
                .append("The \"key\" MUST exactly match one of the function names below. ")
                .append("Skip functions whose code is unclear.\n\n");

        for (FnEntry e : entries) {
            prompt.append("=== ").append(e.displayName());
            if (!e.signature().isBlank()) prompt.append(" — ").append(e.signature());
            prompt.append(" ===\n")
                    .append(truncateBody(e.body(), NARRATE_BODY_LINES))
                    .append("\n\n");
        }

        CompletionResult result;
        try {
            result = invoker.complete(
                    user, projectId, "callchain_narrate_bin",
                    cred,
                    "You are a reverse engineer summarising decompiled C from a binary for a teammate.",
                    prompt.toString(),
                    NARRATE_MAX_TOKENS,
                    model
            );
        } catch (Exception e) {
            throw new ResponseStatusException(HttpStatus.BAD_GATEWAY, "LLM call failed: " + e.getMessage(), e);
        }

        Map<String, String> byKey = parseSummaries(result.text());
        List<BinNarration> narrations = new ArrayList<>(entries.size());
        for (FnEntry e : entries) {
            String s = byKey.get(e.displayName());
            // Some models tag with the original (pre-rename) name even when
            // we asked for displayName. Fall back to that before giving up.
            if ((s == null || s.isBlank()) && !e.originalName().equals(e.displayName())) {
                s = byKey.get(e.originalName());
            }
            if (s != null && !s.isBlank()) {
                narrations.add(new BinNarration(e.displayName(), s));
            }
        }
        return new NarrateBinChainResponse(
                narrations, result.inputTokens(), result.outputTokens(), result.model());
    }

    private void collectRefs(CallChainNode n, LinkedHashMap<String, MethodRef> into) {
        into.putIfAbsent(refKey(n.method()), n.method());
        for (CallChainNode c : n.children()) collectRefs(c, into);
    }

    private CallChainNode withNarration(CallChainNode n, Map<String, String> byKey) {
        String narr = byKey.getOrDefault(refKey(n.method()), "");
        List<CallChainNode> kids = n.children().stream().map(c -> withNarration(c, byKey)).toList();
        return new CallChainNode(n.method(), n.snippet(), narr, kids, n.childrenStats());
    }

    private String readBodyByRef(UUID projectId, Path root, MethodRef ref) {
        Path file = root.resolve(ref.file());
        try {
            String content = renameService.applyMapToContent(projectId,
                    Files.readString(file, StandardCharsets.UTF_8));
            List<String> lines = List.of(content.split("\n", -1));
            int depth = 0;
            boolean started = false;
            int end = lines.size();
            for (int i = ref.line() - 1; i < lines.size(); i++) {
                String line = lines.get(i);
                for (int c = 0; c < line.length(); c++) {
                    char ch = line.charAt(c);
                    if (ch == '{') { depth++; started = true; }
                    else if (ch == '}') { depth--; if (started && depth <= 0) { end = i + 1; break; } }
                }
                if (started && depth <= 0) break;
            }
            int from = Math.max(0, ref.line() - 1);
            if (end <= from) return "";
            return String.join("\n", lines.subList(from, end));
        } catch (IOException e) {
            return "";
        }
    }

    private static String truncateBody(String body, int maxLines) {
        if (body == null || body.isEmpty()) return "";
        String[] lines = body.split("\n", -1);
        if (lines.length <= maxLines) return body;
        StringBuilder sb = new StringBuilder();
        for (int i = 0; i < maxLines; i++) sb.append(lines[i]).append('\n');
        sb.append("    // … (").append(lines.length - maxLines).append(" more lines)\n");
        return sb.toString();
    }

    private Map<String, String> parseSummaries(String json) {
        Map<String, String> out = new HashMap<>();
        try {
            // Tolerate fenced code blocks the model sometimes emits.
            String cleaned = json.trim();
            if (cleaned.startsWith("```")) {
                int firstNl = cleaned.indexOf('\n');
                int lastFence = cleaned.lastIndexOf("```");
                if (firstNl >= 0 && lastFence > firstNl) {
                    cleaned = cleaned.substring(firstNl + 1, lastFence).trim();
                }
            }
            JsonNode root = mapper.readTree(cleaned);
            JsonNode arr = root.path("summaries");
            if (arr.isArray()) {
                for (JsonNode n : arr) {
                    String k = n.path("key").asString("");
                    String s = n.path("summary").asString("");
                    if (!k.isEmpty()) out.put(k, s);
                }
            }
        } catch (Exception e) {
            log.warn("narration parse failed; returning empty: {}", e.toString());
        }
        return out;
    }

    private static MethodRef methodRefFor(Symbol s) {
        return new MethodRef(s.className(), s.name(), s.signature(), s.file(), s.line());
    }

    private static String methodKey(Symbol s) {
        return s.file() + ":" + s.line() + ":" + s.name();
    }

    private static String refKey(MethodRef r) {
        return r.file() + ":" + r.line();
    }
}
