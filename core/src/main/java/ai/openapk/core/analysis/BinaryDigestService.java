package ai.openapk.core.analysis;

import ai.openapk.core.analysis.dto.BinaryDigest;
import ai.openapk.core.analysis.dto.BinaryDigest.Hints;
import ai.openapk.core.analysis.dto.BinaryDigest.SuspiciousImport;
import ai.openapk.core.analysis.dto.BinaryDigest.TopFunction;
import ai.openapk.core.analysis.dto.Ioc;
import ai.openapk.core.projects.Project;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;

import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;
import java.util.Map;
import java.util.regex.Pattern;

/**
 * Produces a {@link BinaryDigest} from a BIN project's stored worker JSON.
 * Pure-static, no LLM tokens spent — same role
 * {@link StaticDigestService} plays for APK projects.
 *
 * <p>Strategy: parse {@code projects.binary_analysis_jsonb}, classify each
 * import via {@link #IMPORT_CATEGORIES} / {@link #CRYPTO_PREFIXES}, scan
 * strings for high-signal patterns, run {@link IoCExtractor} over the full
 * strings list to pick up URLs/IPs/emails. The output is meant to be a few
 * KB of JSON — small enough to fit comfortably in a prompt while carrying
 * the signal an analyst would reach for first.
 */
@Service
public class BinaryDigestService {

    private static final Logger log = LoggerFactory.getLogger(BinaryDigestService.class);

    /** How many of the largest concrete (non-thunk, non-external) functions to surface. */
    private static final int TOP_FUNCTION_COUNT = 20;
    /** How many suspicious strings to keep (after pattern + dedupe filter). */
    private static final int MAX_SUSPICIOUS_STRINGS = 60;

    /**
     * Exact-match import name → category. Names are deliberately listed both
     * with and without the {@code A}/{@code W} suffix for Win32 APIs because
     * Ghidra resolves to either form depending on how it ran the analyzer.
     * Crypto APIs use prefix matching (see {@link #CRYPTO_PREFIXES}) instead
     * because the variant space is too large for an exact list.
     */
    private static final Map<String, String> IMPORT_CATEGORIES = Map.ofEntries(
            // anti-debug / anti-analysis
            Map.entry("ptrace",                      "anti-debug"),
            Map.entry("IsDebuggerPresent",           "anti-debug"),
            Map.entry("CheckRemoteDebuggerPresent",  "anti-debug"),
            Map.entry("NtQueryInformationProcess",   "anti-debug"),
            Map.entry("OutputDebugStringA",          "anti-debug"),
            Map.entry("OutputDebugStringW",          "anti-debug"),
            Map.entry("GetTickCount",                "anti-debug"),
            Map.entry("QueryPerformanceCounter",     "anti-debug"),
            // dynamic loading / runtime resolution
            Map.entry("dlopen",                      "dynamic-loading"),
            Map.entry("dlsym",                       "dynamic-loading"),
            Map.entry("LoadLibraryA",                "dynamic-loading"),
            Map.entry("LoadLibraryW",                "dynamic-loading"),
            Map.entry("LoadLibraryExA",              "dynamic-loading"),
            Map.entry("LoadLibraryExW",              "dynamic-loading"),
            Map.entry("GetProcAddress",              "dynamic-loading"),
            // networking
            Map.entry("socket",                      "networking"),
            Map.entry("connect",                     "networking"),
            Map.entry("send",                        "networking"),
            Map.entry("recv",                        "networking"),
            Map.entry("gethostbyname",               "networking"),
            Map.entry("getaddrinfo",                 "networking"),
            Map.entry("WSAStartup",                  "networking"),
            Map.entry("WSASocketA",                  "networking"),
            Map.entry("InternetOpenA",               "networking"),
            Map.entry("InternetOpenW",               "networking"),
            Map.entry("InternetOpenUrlA",            "networking"),
            Map.entry("InternetOpenUrlW",            "networking"),
            Map.entry("InternetConnectA",            "networking"),
            Map.entry("HttpSendRequestA",            "networking"),
            Map.entry("HttpOpenRequestA",            "networking"),
            Map.entry("URLDownloadToFileA",          "networking"),
            Map.entry("URLDownloadToFileW",          "networking"),
            // exec / shell
            Map.entry("system",                      "exec-shell"),
            Map.entry("popen",                       "exec-shell"),
            Map.entry("execve",                      "exec-shell"),
            Map.entry("execl",                       "exec-shell"),
            Map.entry("execlp",                      "exec-shell"),
            Map.entry("execvp",                      "exec-shell"),
            Map.entry("fork",                        "exec-shell"),
            Map.entry("CreateProcessA",              "exec-shell"),
            Map.entry("CreateProcessW",              "exec-shell"),
            Map.entry("WinExec",                     "exec-shell"),
            Map.entry("ShellExecuteA",               "exec-shell"),
            Map.entry("ShellExecuteW",               "exec-shell"),
            Map.entry("ShellExecuteExA",             "exec-shell"),
            Map.entry("ShellExecuteExW",             "exec-shell"),
            // memory injection / process manipulation
            Map.entry("VirtualAlloc",                "memory-injection"),
            Map.entry("VirtualAllocEx",              "memory-injection"),
            Map.entry("VirtualProtect",              "memory-injection"),
            Map.entry("VirtualProtectEx",            "memory-injection"),
            Map.entry("CreateRemoteThread",          "memory-injection"),
            Map.entry("CreateRemoteThreadEx",        "memory-injection"),
            Map.entry("WriteProcessMemory",          "memory-injection"),
            Map.entry("ReadProcessMemory",           "memory-injection"),
            Map.entry("OpenProcess",                 "memory-injection"),
            Map.entry("SetWindowsHookExA",           "memory-injection"),
            Map.entry("SetWindowsHookExW",           "memory-injection"),
            Map.entry("NtMapViewOfSection",          "memory-injection"),
            Map.entry("ZwMapViewOfSection",          "memory-injection"),
            Map.entry("mprotect",                    "memory-injection")
    );

    /** Substrings that flag an import as crypto. Lowercase comparison. */
    private static final List<String> CRYPTO_PREFIXES = List.of(
            "EVP_", "AES_", "DES_", "RC4_", "MD5_", "SHA1_", "SHA256_", "SHA512_",
            "BCrypt", "CryptAcquireContext", "CryptEncrypt", "CryptDecrypt", "CryptHashData",
            "CryptGenRandom", "RAND_", "RSA_"
    );

    /** Patterns that mark a string as worth surfacing even if not an IoC. */
    private static final List<Pattern> SUSPICIOUS_STRING_PATTERNS = List.of(
            Pattern.compile("/proc/(self|\\d+)/(status|stat|maps|cmdline)"),
            Pattern.compile("TracerPid"),
            Pattern.compile("/bin/(sh|bash|dash|zsh)"),
            Pattern.compile("/system/bin/"),
            Pattern.compile("cmd\\.exe", Pattern.CASE_INSENSITIVE),
            Pattern.compile("powershell\\.exe", Pattern.CASE_INSENSITIVE),
            Pattern.compile("\\b(?:gdb|ida|x64dbg|x32dbg|ollydbg|windbg|strace|ltrace|frida)\\b",
                    Pattern.CASE_INSENSITIVE),
            Pattern.compile("HKEY_LOCAL_MACHINE|HKEY_CURRENT_USER"),
            Pattern.compile("SOFTWARE\\\\Microsoft\\\\Windows", Pattern.CASE_INSENSITIVE),
            Pattern.compile("/etc/(passwd|shadow|hosts)"),
            Pattern.compile("\\b[\\w.-]+\\.onion\\b"),
            Pattern.compile("User-Agent", Pattern.CASE_INSENSITIVE),
            Pattern.compile("(?i)\\b(?:cookie|session|api[_-]?key|bearer|token)\\s*[:=]"),
            Pattern.compile("(?i)\\b(?:select|insert|update|delete)\\s+.*\\b(?:from|into|where)\\b")
    );

    private final ObjectMapper mapper;
    private final IoCExtractor iocExtractor;

    public BinaryDigestService(ObjectMapper mapper, IoCExtractor iocExtractor) {
        this.mapper = mapper;
        this.iocExtractor = iocExtractor;
    }

    /**
     * Build a digest from the project's stored binary analysis JSON. Caller is
     * expected to have already enforced kind=BIN and status=READY; we still
     * defend against an empty blob (returns a near-empty digest with only
     * the project's metadata columns populated).
     */
    public BinaryDigest computeFromProject(Project project) {
        String raw = project.getBinaryAnalysisJson();
        if (raw == null || raw.isBlank()) {
            return emptyDigest(project);
        }

        JsonNode root;
        try {
            root = mapper.readTree(raw);
        } catch (Exception e) {
            log.warn("binary_analysis_jsonb unreadable for project {}: {}",
                    project.getId(), e.toString());
            return emptyDigest(project);
        }

        // ---- imports → categorized + hints ----
        List<String> rawImports = readStringArray(root.path("imports"));
        List<SuspiciousImport> suspiciousImports = new ArrayList<>();
        boolean antiDebug = false, crypto = false, networking = false;
        boolean dynamicLoading = false, execShell = false, memoryInjection = false;
        for (String name : rawImports) {
            String category = classifyImport(name);
            if (category == null) continue;
            suspiciousImports.add(new SuspiciousImport(name, category));
            switch (category) {
                case "anti-debug"        -> antiDebug = true;
                case "crypto"            -> crypto = true;
                case "networking"        -> networking = true;
                case "dynamic-loading"   -> dynamicLoading = true;
                case "exec-shell"        -> execShell = true;
                case "memory-injection"  -> memoryInjection = true;
                default -> { /* ignore unknown */ }
            }
        }
        // Stable order so the prompt is deterministic — group by category, then name.
        suspiciousImports.sort(
                Comparator.comparing(SuspiciousImport::category)
                        .thenComparing(SuspiciousImport::name)
        );

        // ---- strings → suspicious + IoCs ----
        List<String> allStrings = readStringArray(root.path("strings"));
        List<String> suspiciousStrings = filterSuspiciousStrings(allStrings);
        List<Ioc> iocs = iocExtractor.extract(allStrings);

        // ---- top functions: largest concrete bodies ----
        List<TopFunction> topFns = topFunctions(root.path("functions"));

        // ---- metadata pulled from project columns, with worker metadata as fallback ----
        JsonNode meta = root.path("metadata");
        String arch = nonBlankOr(project.getArch(), readText(meta, "arch"));
        String fmt = nonBlankOr(project.getExecutableFormat(), readText(meta, "executable_format"));
        String compiler = nonBlankOr(project.getCompiler(), readText(meta, "compiler"));
        String langId = nonBlankOr(project.getLanguageId(), readText(meta, "language"));
        String imageBase = nonBlankOr(project.getImageBase(), readText(meta, "image_base"));

        return new BinaryDigest(
                arch, fmt, compiler, langId, imageBase,
                root.path("functions").size(),
                allStrings.size(),
                rawImports.size(),
                suspiciousImports,
                suspiciousStrings,
                iocs,
                new Hints(antiDebug, crypto, networking, dynamicLoading, execShell, memoryInjection),
                topFns
        );
    }

    private BinaryDigest emptyDigest(Project p) {
        return new BinaryDigest(
                p.getArch(), p.getExecutableFormat(), p.getCompiler(),
                p.getLanguageId(), p.getImageBase(),
                0, 0, 0,
                List.of(), List.of(), List.of(),
                new Hints(false, false, false, false, false, false),
                List.of()
        );
    }

    private static String classifyImport(String name) {
        if (name == null) return null;
        String exact = IMPORT_CATEGORIES.get(name);
        if (exact != null) return exact;
        for (String prefix : CRYPTO_PREFIXES) {
            if (name.startsWith(prefix) || name.contains(prefix)) return "crypto";
        }
        return null;
    }

    private static List<String> filterSuspiciousStrings(List<String> strings) {
        List<String> out = new ArrayList<>();
        var seen = new java.util.HashSet<String>();
        for (String s : strings) {
            if (s == null || s.length() > 240) continue;
            for (Pattern p : SUSPICIOUS_STRING_PATTERNS) {
                if (p.matcher(s).find()) {
                    if (seen.add(s)) out.add(s);
                    break;
                }
            }
            if (out.size() >= MAX_SUSPICIOUS_STRINGS) break;
        }
        return out;
    }

    private static List<TopFunction> topFunctions(JsonNode functions) {
        if (!functions.isArray() || functions.isEmpty()) return List.of();
        List<TopFunction> all = new ArrayList<>();
        for (JsonNode fn : functions) {
            if (fn.path("external").asBoolean(false)) continue;
            if (fn.path("thunk").asBoolean(false)) continue;
            int size = fn.path("size").asInt(0);
            if (size <= 0) continue;
            String name = readText(fn, "name");
            String addr = readText(fn, "address");
            if (name == null) continue;
            all.add(new TopFunction(name, addr, size));
        }
        all.sort(Comparator.comparingInt(TopFunction::size).reversed());
        return all.size() <= TOP_FUNCTION_COUNT ? all : all.subList(0, TOP_FUNCTION_COUNT);
    }

    private static List<String> readStringArray(JsonNode node) {
        if (!node.isArray() || node.isEmpty()) return List.of();
        List<String> out = new ArrayList<>(node.size());
        for (JsonNode v : node) {
            String s = v.asString("");
            if (!s.isEmpty()) out.add(s);
        }
        return out;
    }

    private static String readText(JsonNode node, String field) {
        JsonNode v = node.path(field);
        if (v.isMissingNode() || v.isNull()) return null;
        String s = v.asString("");
        return s.isBlank() ? null : s;
    }

    private static String nonBlankOr(String first, String fallback) {
        return first != null && !first.isBlank() ? first : fallback;
    }
}
