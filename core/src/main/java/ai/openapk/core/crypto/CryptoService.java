package ai.openapk.core.crypto;

import ai.openapk.core.analysis.LlmInvoker;
import ai.openapk.core.analysis.dto.SignatureHit;
import ai.openapk.core.analysis.dto.StaticDigest;
import ai.openapk.core.auth.User;
import ai.openapk.core.credentials.LlmCredential;
import ai.openapk.core.credentials.LlmCredentialRepository;
import ai.openapk.core.crypto.dto.CryptoHit;
import ai.openapk.core.crypto.dto.CyberChefOp;
import ai.openapk.core.crypto.dto.GenerateBinDecryptorRequest;
import ai.openapk.core.crypto.dto.GenerateBinDecryptorResponse;
import ai.openapk.core.crypto.dto.GenerateDecryptorRequest;
import ai.openapk.core.crypto.dto.GenerateDecryptorResponse;
import ai.openapk.core.projects.Project;
import ai.openapk.core.projects.ProjectKind;
import ai.openapk.core.projects.ProjectRepository;
import ai.openapk.core.projects.analysis.BinaryAnalysisLoader;
import ai.openapk.core.projects.storage.ProjectStorage;
import ai.openapk.core.renames.RenameService;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.server.ResponseStatusException;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import java.nio.file.Path;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;

@Service
public class CryptoService {

    private static final Logger log = LoggerFactory.getLogger(CryptoService.class);
    private static final int CONTEXT_LINES_BEFORE = 15;
    private static final int CONTEXT_LINES_AFTER = 40;
    private static final int MAX_TOKENS = 1500;

    private static boolean isSdkPath(String file) {
        return ai.openapk.core.util.SdkPaths.isSdkPath(file);
    }

    /** Prompt assumes Java input + Python output. */
    private static final String SYSTEM_PROMPT = """
            You are a malware reverse-engineer. The user shows a snippet of decompiled Java that \
            implements crypto or hand-rolled string obfuscation (likely AES/DES/RC4/XOR/hashing/Base64). \
            Generate a self-contained Python 3 script that REPRODUCES the same operation, and — when \
            the algorithm maps cleanly to standard CyberChef operations — also emit an equivalent recipe.

            Output JSON only — no markdown fences, no commentary — with this exact shape:
            {
              "script": "<python source>",
              "explanation": "<1-3 sentence summary>",
              "entryMethods": ["<bare method names that callers invoke to decode>"],
              "decryptFunctionName": "<name of the python function callers should invoke, default 'decrypt'>",
              "cyberchefRecipe": [
                {"op": "From Base64", "args": ["A-Za-z0-9+/=", true, false]},
                {"op": "XOR", "args": [{"option": "UTF8", "string": "UTF-8"}, "Standard", false]}
              ]
            }

            Rules for the script:
            1. Stand alone — stdlib + `cryptography` package only, no JVM imports.
            2. Define a function (named per `decryptFunctionName`) that takes a single str OR bytes \
               argument and returns str (for string-obfuscation decoders) or bytes (for general crypto). \
               If the Java input is a base64 string and output is a UTF-8 string (the common malware \
               case), accept str, return str.
            3. Hardcode any constants (keys, IVs, modes, XOR key strings) you can extract from the \
               snippet. If you can't extract them, take them as function parameters with a TODO comment.
            4. Do NOT include an `if __name__ == "__main__":` block — the caller appends one with the \
               harvested ciphertexts.
            5. If unclear about algorithm/mode, flag it in the explanation and best-guess with TODOs.

            `entryMethods` must contain the EXACT, LITERAL Java method names AS THEY APPEAR in the \
            source — do NOT rename, beautify, expand abbreviations, or invent more readable names. \
            If the source declares `public static String a(String s)` and `public String b(...)`, \
            `entryMethods` must be `["a", "b"]`, NOT `["decode", "decodeWithUtf8", "decodeWithKey"]`. \
            These names are fed verbatim into a regex grep across the project; any rewriting breaks \
            ciphertext harvesting. When in doubt, copy the exact identifier characters from the \
            method signatures above.

            Rules for cyberchefRecipe:
            - Use CyberChef's exact operation names ("From Base64", "XOR", "AES Decrypt", "RC4", \
              "MD5", "SHA2", etc.) and exact positional argument orders.
            - Args are stringified as: strings (use literal text), booleans, numbers, or option \
              objects like {"option":"UTF8","string":"the key"}.
            - The recipe must apply to a single ciphertext input and produce the cleartext as output.
            - Set cyberchefRecipe to null (literally `null`) if the algorithm is custom enough that \
              no standard CyberChef op chain reproduces it.
            """;

    /**
     * BIN-specific decryptor prompt. Input is Ghidra-decompiled C from a
     * native binary — typically the user picked the function because they
     * believe it implements obfuscation, hand-rolled crypto, packed-string
     * decoding, or a known cipher. Output is a self-contained Python 3
     * script that recreates the operation.
     */
    private static final String SYSTEM_PROMPT_BIN = """
            You are a reverse engineer. The user shows you ONE function decompiled by Ghidra from \
            a native binary (ELF/PE/Mach-O). The function likely implements obfuscation, hand-rolled \
            encryption, packed-string decoding, a hash, or a known cipher (AES/DES/RC4/XOR/Base64).

            Generate a self-contained Python 3 script that REPRODUCES the same operation. Output JSON \
            only — no markdown fences, no commentary — with this exact shape:
            {
              "script": "<python source>",
              "explanation": "<2-4 sentence summary of what the function does and how the script mirrors it>",
              "algorithm": "<short human-readable label, e.g. 'XOR with rolling 16-byte key', 'AES-128-CBC', 'byte-permuted XOR table'>"
            }

            Rules for the script:
            1. Stand alone — stdlib + `cryptography` package only.
            2. Define a function called `decrypt` (always that exact name) taking either str or bytes \
               and returning the corresponding plaintext type. For string-deobfuscation, accept str \
               and return str.
            3. Hardcode any constants you can recover from the decompiled code (keys, IVs, XOR keys, \
               byte tables, magic constants, lookup tables). If a constant isn't recoverable, take it \
               as a function parameter with a TODO comment naming what it should be.
            4. Do NOT include an `if __name__ == "__main__":` block — the caller will append one with \
               their own test input.
            5. Mirror the byte-handling carefully — endian, signed-vs-unsigned, modular arithmetic \
               must match the C source.
            6. If the function is clearly NOT crypto/obfuscation (e.g. just a string copy, a getter, \
               or unrelated logic), set "algorithm" to "(not crypto)" and return a one-line stub in \
               "script" with a comment explaining why.

            Rules for explanation:
            - Identify the algorithm if recognizable; otherwise describe the byte-level operation.
            - Call out any hardcoded values you embedded in the script.
            - Flag any uncertainty — "unknown IV", "key length ambiguous in source", etc.
            """;

    private final ProjectRepository projectRepo;
    private final ProjectStorage storage;
    private final LlmCredentialRepository credRepo;
    private final LlmInvoker invoker;
    private final RenameService renameService;
    private final ObjectMapper mapper;
    private final BinaryAnalysisLoader analysisLoader;

    public CryptoService(
            ProjectRepository projectRepo,
            ProjectStorage storage,
            LlmCredentialRepository credRepo,
            LlmInvoker invoker,
            RenameService renameService,
            ObjectMapper mapper,
            BinaryAnalysisLoader analysisLoader
    ) {
        this.projectRepo = projectRepo;
        this.storage = storage;
        this.credRepo = credRepo;
        this.invoker = invoker;
        this.renameService = renameService;
        this.mapper = mapper;
        this.analysisLoader = analysisLoader;
    }

    @Transactional(readOnly = true)
    public List<CryptoHit> listHits(User user, UUID projectId, boolean includeSdks) {
        Project project = loadProject(user, projectId);
        if (project.getDigestJson() == null || project.getDigestJson().isBlank()) {
            throw new ResponseStatusException(HttpStatus.CONFLICT,
                    "No static digest yet. Run an analysis from the Analysis tab first.");
        }
        StaticDigest digest;
        try {
            digest = mapper.readValue(project.getDigestJson(), StaticDigest.class);
        } catch (Exception e) {
            throw new ResponseStatusException(HttpStatus.INTERNAL_SERVER_ERROR,
                    "Cached digest unparseable: " + e.getMessage());
        }
        // Pull from both categories — "crypto" (javax.crypto API usage) and
        // "obfuscation_decoder" (hand-rolled Base64+XOR style string decoders).
        // Dedup on (file, line) so a line that triggers both shows once.
        java.util.LinkedHashMap<String, CryptoHit> byKey = new java.util.LinkedHashMap<>();
        // obfuscation_decoder first — usually the actually-interesting findings
        for (SignatureHit h : digest.signatures().getOrDefault("obfuscation_decoder", List.of())) {
            if (!includeSdks && isSdkPath(h.file())) continue;
            byKey.putIfAbsent(h.file() + ":" + h.line(), new CryptoHit(h.file(), h.line(), h.snippet()));
        }
        for (SignatureHit h : digest.signatures().getOrDefault("crypto", List.of())) {
            if (!includeSdks && isSdkPath(h.file())) continue;
            byKey.putIfAbsent(h.file() + ":" + h.line(), new CryptoHit(h.file(), h.line(), h.snippet()));
        }
        return new ArrayList<>(byKey.values());
    }

    /**
     * BIN-specific decryptor generation. Reads the named function's
     * signature + decompiled body from the binary analysis JSON, sends it
     * to the LLM with the BIN-flavored prompt, and returns a Python script
     * that reproduces the operation. Inverse-resolves the function name
     * through RenameService so user-renamed names work.
     */
    @Transactional
    public GenerateBinDecryptorResponse generateForFunction(
            User user, UUID projectId, GenerateBinDecryptorRequest req
    ) {
        Project project = loadProject(user, projectId);
        if (project.getKind() != ProjectKind.BIN) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST,
                    "generate-bin is only available for binary projects");
        }
        LlmCredential cred = loadCredential(user, req.credentialId());

        String json = analysisLoader.load(project);
        if (json == null || json.isBlank()) {
            throw new ResponseStatusException(HttpStatus.CONFLICT, "binary analysis not available");
        }

        String originalName = renameService.resolveOriginal(projectId, req.functionName());
        String signature = "";
        String decompiled = "";
        try {
            JsonNode root = mapper.readTree(json);
            JsonNode functions = root.path("functions");
            if (functions.isArray()) {
                for (JsonNode fn : functions) {
                    if (!originalName.equals(fn.path("name").asString(""))) continue;
                    if (fn.path("external").asBoolean(false)) break;
                    if (fn.path("thunk").asBoolean(false)) break;
                    signature = fn.path("signature").asString("");
                    decompiled = fn.path("decompiled").asString("");
                    break;
                }
            }
        } catch (RuntimeException e) {
            throw new ResponseStatusException(HttpStatus.INTERNAL_SERVER_ERROR,
                    "binary analysis JSON corrupt: " + e.getMessage());
        }
        if (decompiled.isBlank()) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST,
                    "function '" + req.functionName() + "' has no decompiled body to analyze");
        }

        String userPrompt = "Function: " + req.functionName() + "\n\n"
                + "Signature: " + signature + "\n\n"
                + "Decompiled C:\n```c\n" + decompiled + "\n```\n";
        var result = invoker.complete(
                user, projectId, "crypto_generate_bin",
                cred, SYSTEM_PROMPT_BIN, userPrompt, MAX_TOKENS, req.model());
        markCredentialUsed(cred);

        JsonNode root = extractJson(result.text());
        String script = root == null ? "" : root.path("script").asString("");
        String explanation = root == null ? "(model emitted no JSON)" : root.path("explanation").asString("");
        String algorithm = root == null ? "" : root.path("algorithm").asString("");
        if (script.isBlank()) {
            log.warn("crypto generate-bin: model returned no script. raw head: {}",
                    result.text().substring(0, Math.min(300, result.text().length())));
            throw new ResponseStatusException(HttpStatus.BAD_GATEWAY,
                    "Model did not return a usable script. Try again or pick a different model.");
        }

        log.info("crypto generate-bin: project={} fn={} alg='{}' scriptLen={}",
                projectId, originalName, algorithm, script.length());

        return new GenerateBinDecryptorResponse(
                script,
                explanation,
                algorithm,
                result.inputTokens(),
                result.outputTokens(),
                result.model());
    }

    @Transactional
    public GenerateDecryptorResponse generate(User user, UUID projectId, GenerateDecryptorRequest req) {
        Project project = loadProject(user, projectId);
        LlmCredential cred = loadCredential(user, req.credentialId());

        String context = extractContext(user, projectId, req.file(), req.line());
        // Apply project renames so the AI sees human-readable identifiers if the user already
        // accepted any. Cleaner reasoning, better generated scripts.
        context = renameService.applyMapToContent(projectId, context);

        String userPrompt = "File: " + req.file() + " (line " + req.line() + ")\n\n```java\n" + context + "\n```";
        var result = invoker.complete(user, projectId, "crypto_analyze", cred, SYSTEM_PROMPT, userPrompt, MAX_TOKENS, req.model());
        markCredentialUsed(cred);

        JsonNode root = extractJson(result.text());
        String script = root == null ? "" : root.path("script").asString("");
        String explanation = root == null ? "(model emitted no JSON)" : root.path("explanation").asString("");
        String decryptFn = root == null ? "decrypt" : root.path("decryptFunctionName").asString("decrypt");
        if (decryptFn.isBlank()) decryptFn = "decrypt";

        if (script.isBlank()) {
            log.warn("crypto generate: model returned no script. raw head: {}",
                    result.text().substring(0, Math.min(300, result.text().length())));
            throw new ResponseStatusException(HttpStatus.BAD_GATEWAY,
                    "Model did not return a usable script. Try again or pick a different model.");
        }

        java.util.LinkedHashSet<String> entryMethods = new java.util.LinkedHashSet<>();
        if (root != null) {
            for (JsonNode n : root.path("entryMethods")) {
                String m = n.asString("");
                if (!m.isBlank() && m.matches("[A-Za-z_$][\\w$]*")) entryMethods.add(m);
            }
        }
        // Regex-extract method declarations from the actual source — the AI sometimes
        // hallucinates "human-readable" names instead of returning the literal `a`/`b`
        // identifiers. Union ensures the harvest regex actually matches call-sites.
        entryMethods.addAll(extractMethodNamesFromSource(user, projectId, req.file()));

        String className = simpleClassName(req.file());
        List<String> ciphertexts = entryMethods.isEmpty()
                ? List.of()
                : harvestCiphertexts(user, projectId, className, new ArrayList<>(entryMethods));

        String finalScript = appendHarvestedBlock(script, decryptFn, ciphertexts);
        List<CyberChefOp> recipe = root == null ? null : parseCyberChefRecipe(root.path("cyberchefRecipe"));

        log.info("crypto generate: project={} class={} methods={} ciphertexts={} recipeOps={}",
                projectId, className, entryMethods, ciphertexts.size(), recipe == null ? "null" : recipe.size());

        return new GenerateDecryptorResponse(
                finalScript,
                explanation,
                className,
                new ArrayList<>(entryMethods),
                ciphertexts,
                recipe,
                result.model(),
                result.inputTokens(),
                result.outputTokens()
        );
    }

    /**
     * Regex-pulls method names out of the source file so the harvest doesn't depend
     * on the AI returning literal identifiers (Sonnet sometimes "improves" `a`/`b`
     * to `decodeWithKey` etc., which breaks the call-site grep).
     *
     * <p>Captures public, package-private, protected, or static methods whose name is
     * a bare identifier. Skips constructors (name == class name).
     */
    private List<String> extractMethodNamesFromSource(User user, UUID projectId, String relPath) {
        Path root = storage.srcDir(user.getId(), projectId).normalize();
        Path resolved = root.resolve(relPath).normalize();
        if (!resolved.startsWith(root) || !Files.isRegularFile(resolved)) return List.of();
        String content;
        try {
            content = Files.readString(resolved, StandardCharsets.UTF_8);
        } catch (IOException e) {
            return List.of();
        }
        // (?:public|protected|private|static|final|synchronized|abstract|\s)+ <returnType> name(...)
        // Loose match — captures most declarations even when modifiers vary. Excludes
        // anything that looks like a control-flow keyword (`if`/`for`/`while`/`switch`/`catch`).
        Pattern decl = Pattern.compile(
                "(?m)(?:public|protected|private)\\s+(?:static\\s+|final\\s+|synchronized\\s+|abstract\\s+)*" +
                "[\\w<>\\[\\]?,\\s.$]+?\\s+(\\w+)\\s*\\([^)]*\\)\\s*(?:throws[^{]*)?\\{"
        );
        String className = simpleClassName(relPath);
        java.util.LinkedHashSet<String> out = new java.util.LinkedHashSet<>();
        Matcher m = decl.matcher(content);
        while (m.find()) {
            String name = m.group(1);
            if (name.equals(className)) continue; // constructor
            if (List.of("if", "for", "while", "switch", "catch", "return", "new").contains(name)) continue;
            out.add(name);
        }
        return new ArrayList<>(out);
    }

    /**
     * Walk the AI's `cyberchefRecipe` array into {@link CyberChefOp} records.
     * Returns null if the field is missing/null/not-an-array — the frontend uses that
     * signal to hide the CyberChef buttons.
     */
    private List<CyberChefOp> parseCyberChefRecipe(JsonNode node) {
        if (node == null || node.isNull() || !node.isArray() || node.isEmpty()) return null;
        List<CyberChefOp> ops = new ArrayList<>();
        for (JsonNode opNode : node) {
            String op = opNode.path("op").asString("");
            if (op.isBlank()) continue;
            List<Object> args = new ArrayList<>();
            for (JsonNode a : opNode.path("args")) args.add(jsonNodeToPlain(a));
            ops.add(new CyberChefOp(op, args));
        }
        return ops.isEmpty() ? null : ops;
    }

    /** JsonNode → plain Java value (String / Boolean / Number / Map / List). */
    private Object jsonNodeToPlain(JsonNode n) {
        if (n == null || n.isNull()) return null;
        if (n.isString()) return n.asString("");
        if (n.isBoolean()) return n.asBoolean(false);
        if (n.isInt() || n.isLong()) return n.asLong();
        if (n.isNumber()) return n.asDouble();
        if (n.isArray()) {
            List<Object> out = new ArrayList<>();
            for (JsonNode child : n) out.add(jsonNodeToPlain(child));
            return out;
        }
        if (n.isObject()) {
            java.util.LinkedHashMap<String, Object> map = new java.util.LinkedHashMap<>();
            n.properties().forEach(e -> map.put(e.getKey(), jsonNodeToPlain(e.getValue())));
            return map;
        }
        return n.asString("");
    }

    /** From "defpackage/c.java" → "c". From "com/foo/Bar.java" → "Bar". */
    private static String simpleClassName(String filePath) {
        String base = filePath.replace('\\', '/');
        int slash = base.lastIndexOf('/');
        String file = slash >= 0 ? base.substring(slash + 1) : base;
        return file.endsWith(".java") ? file.substring(0, file.length() - 5) : file;
    }

    /**
     * Walk every .java file under the project's srcDir and harvest unique string
     * literals passed to {@code className.<entryMethod>("...")} calls. Filters to
     * base64-ish strings to suppress false positives (e.g. another unrelated
     * class also named {@code c}).
     */
    private List<String> harvestCiphertexts(User user, UUID projectId, String className, List<String> entryMethods) {
        Path root = storage.srcDir(user.getId(), projectId).normalize();
        if (!Files.isDirectory(root)) return List.of();

        String methodAlt = String.join("|", entryMethods.stream().map(Pattern::quote).toList());
        Pattern call = Pattern.compile(
                "\\b" + Pattern.quote(className) + "\\.(?:" + methodAlt + ")\\s*\\(\\s*\"([^\"]+)\"\\s*[,)]"
        );
        // base64-ish: alphanumerics + + / = , length >= 8 to skip noise
        Pattern b64ish = Pattern.compile("^[A-Za-z0-9+/=_-]{8,}$");

        java.util.LinkedHashSet<String> found = new java.util.LinkedHashSet<>();
        final int MAX_FILES = 5_000;
        final int MAX_CIPHERTEXTS = 500;
        final long MAX_FILE_BYTES = 512 * 1024;

        try (java.util.stream.Stream<Path> walk = Files.walk(root)) {
            var iter = walk.filter(Files::isRegularFile)
                    .filter(p -> p.getFileName().toString().endsWith(".java"))
                    // Skip bundled SDK code — those `c.a("...")` matches are virtually
                    // always false positives (unrelated classes that happen to share names).
                    .filter(p -> !isSdkPath(root.relativize(p).toString()))
                    .limit(MAX_FILES)
                    .iterator();
            while (iter.hasNext() && found.size() < MAX_CIPHERTEXTS) {
                Path p = iter.next();
                try {
                    if (Files.size(p) > MAX_FILE_BYTES) continue;
                    String content = Files.readString(p, StandardCharsets.UTF_8);
                    Matcher m = call.matcher(content);
                    while (m.find() && found.size() < MAX_CIPHERTEXTS) {
                        String lit = m.group(1);
                        if (b64ish.matcher(lit).matches()) found.add(lit);
                    }
                } catch (IOException e) {
                    // skip unreadable
                }
            }
        } catch (IOException e) {
            log.warn("harvestCiphertexts walk failed: {}", e.toString());
        }
        return new ArrayList<>(found);
    }

    /**
     * Append a self-running main block that calls the decoder on every harvested
     * ciphertext. Cheap copy/paste UX: user runs the script and sees the cleartext
     * for every obfuscated literal in the APK.
     */
    private String appendHarvestedBlock(String script, String decryptFn, List<String> ciphertexts) {
        StringBuilder sb = new StringBuilder(script);
        if (!script.endsWith("\n")) sb.append('\n');
        sb.append("\n\n# --- Auto-harvested ciphertexts (").append(ciphertexts.size())
                .append(") from project source ---\n");
        sb.append("CIPHERTEXTS = [\n");
        for (String ct : ciphertexts) {
            sb.append("    ").append(pythonRepr(ct)).append(",\n");
        }
        sb.append("]\n\n");
        sb.append("if __name__ == \"__main__\":\n");
        if (ciphertexts.isEmpty()) {
            sb.append("    # No call sites detected. Pass your own ciphertext to ").append(decryptFn).append("().\n");
            sb.append("    pass\n");
        } else {
            sb.append("    for ct in CIPHERTEXTS:\n");
            sb.append("        try:\n");
            sb.append("            print(f\"{ct!r}\\n  -> {").append(decryptFn).append("(ct)!r}\\n\")\n");
            sb.append("        except Exception as e:\n");
            sb.append("            print(f\"{ct!r}\\n  !! {e}\\n\")\n");
        }
        return sb.toString();
    }

    /** Conservative Python string literal for printable ASCII; falls back to repr-style escaping. */
    private static String pythonRepr(String s) {
        StringBuilder sb = new StringBuilder(s.length() + 2);
        sb.append('"');
        for (int i = 0; i < s.length(); i++) {
            char c = s.charAt(i);
            switch (c) {
                case '\\' -> sb.append("\\\\");
                case '"'  -> sb.append("\\\"");
                case '\n' -> sb.append("\\n");
                case '\r' -> sb.append("\\r");
                case '\t' -> sb.append("\\t");
                default -> {
                    if (c >= 0x20 && c < 0x7F) sb.append(c);
                    else sb.append(String.format("\\u%04x", (int) c));
                }
            }
        }
        sb.append('"');
        return sb.toString();
    }

    private String extractContext(User user, UUID projectId, String relPath, int line) {
        Path root = storage.srcDir(user.getId(), projectId).normalize();
        Path resolved = root.resolve(relPath).normalize();
        if (!resolved.startsWith(root)) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "path escapes project root");
        }
        if (!Files.isRegularFile(resolved)) {
            throw new ResponseStatusException(HttpStatus.NOT_FOUND, "not a regular file");
        }
        try {
            List<String> lines = Files.readAllLines(resolved, StandardCharsets.UTF_8);
            int start = Math.max(0, line - 1 - CONTEXT_LINES_BEFORE);
            int end = Math.min(lines.size(), line - 1 + CONTEXT_LINES_AFTER);
            return String.join("\n", lines.subList(start, end));
        } catch (IOException e) {
            throw new ResponseStatusException(HttpStatus.INTERNAL_SERVER_ERROR, "read failed: " + e.getMessage());
        }
    }

    private JsonNode extractJson(String text) {
        if (text == null || text.isBlank()) return null;
        int start = text.indexOf('{');
        if (start < 0) return null;
        int depth = 0;
        for (int i = start; i < text.length(); i++) {
            char c = text.charAt(i);
            if (c == '{') depth++;
            else if (c == '}') {
                depth--;
                if (depth == 0) {
                    try {
                        return mapper.readTree(text.substring(start, i + 1));
                    } catch (Exception e) {
                        return null;
                    }
                }
            }
        }
        return null;
    }

    private Project loadProject(User user, UUID projectId) {
        return projectRepo.findByIdAndUserId(projectId, user.getId())
                .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND, "project not found"));
    }

    private LlmCredential loadCredential(User user, UUID credentialId) {
        return credRepo.findByIdAndUserId(credentialId, user.getId())
                .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND, "credential not found"));
    }

    private void markCredentialUsed(LlmCredential cred) {
        cred.setLastUsedAt(Instant.now());
        credRepo.save(cred);
    }
}
