package ai.openapk.core.symbols.usages;

import ai.openapk.core.projects.storage.ProjectStorage;
import ai.openapk.core.util.SdkPaths;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.scheduling.annotation.Async;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.io.IOException;
import java.nio.charset.MalformedInputException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayDeque;
import java.util.ArrayList;
import java.util.Deque;
import java.util.HashSet;
import java.util.Iterator;
import java.util.List;
import java.util.Set;
import java.util.UUID;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import java.util.stream.Stream;

/**
 * Scans a project's decompiled .java tree and writes one row per call-site
 * into {@code project_usages}. Runs once at JADX completion; can be re-run
 * via {@link #rebuild}.
 *
 * <p>Captures three kinds of usages:
 * <ul>
 *   <li><b>method</b> — {@code foo(...)} or {@code obj.foo(...)} call sites</li>
 *   <li><b>ctor</b> — {@code new Foo(...)} expressions</li>
 *   <li><b>ref</b> — {@code Type::foo} method references</li>
 * </ul>
 *
 * <p>Skips single-character identifiers (obfuscated "a"/"b"/"c" would dominate
 * the table with no useful signal). Keywords that syntactically look like
 * calls — {@code if(...)}, {@code while(...)} — are filtered too.
 */
@Service
public class UsageIndexerService {

    private static final Logger log = LoggerFactory.getLogger(UsageIndexerService.class);

    private static final int MAX_FILES = 200_000;
    private static final long MAX_FILE_BYTES = 2L * 1024 * 1024; // 2 MB

    /** Java keywords + common false positives that match the call-site shape but
     *  aren't actually method invocations. */
    private static final Set<String> NON_CALLS = Set.of(
            "if", "for", "while", "switch", "catch", "return", "new",
            "synchronized", "try", "do", "else", "throw", "throws",
            "this", "super", "assert", "instanceof", "case", "break", "continue",
            "void", "int", "long", "float", "double", "boolean", "byte", "char", "short"
    );

    /** Match `name(` where `name` is NOT preceded by `.` (so `foo.bar(` still
     *  matches `bar` as a method call but not `foo`). The {@code new Foo(...)}
     *  branch is handled separately so we can tag it as kind=ctor. */
    private static final Pattern METHOD_CALL = Pattern.compile(
            "(?<![\\w.])(\\w{2,})\\s*\\("
    );

    /** Match `new Name(` — captures only the class name. */
    private static final Pattern CTOR_CALL = Pattern.compile(
            "\\bnew\\s+(\\w{2,})\\s*\\("
    );

    /** Match `Type::name` method references. The receiver may be a class or
     *  an instance variable; we capture the trailing identifier. */
    private static final Pattern METHOD_REF = Pattern.compile(
            "::\\s*(\\w{2,})"
    );

    /** Loose method-declaration matcher used ONLY to track the enclosing-method
     *  stack while scanning. Far less strict than SymbolService.METHOD_DECL —
     *  we don't care about correctness for indexing the *declaration*, only
     *  enough signal to associate call-sites with the surrounding method. */
    private static final Pattern METHOD_DECL_FAST = Pattern.compile(
            "(?:^|\\s)(?:public|private|protected|static|final|abstract|synchronized|native|default)\\s+" +
            "[\\w<>\\[\\]?,.\\s$]+?\\s+(\\w+)\\s*\\([^)]*\\)\\s*(?:throws[^{;]*)?\\s*[{;]"
    );

    private static final Pattern CLASS_DECL_FAST = Pattern.compile(
            "(?:^|\\s)(?:class|interface|enum)\\s+(\\w+)"
    );

    private final ProjectStorage storage;
    private final ProjectUsageRepository repo;

    public UsageIndexerService(ProjectStorage storage, ProjectUsageRepository repo) {
        this.storage = storage;
        this.repo = repo;
    }

    /**
     * Build the usage index for a project from scratch. Wipes any existing
     * rows for the project, walks the src tree, bulk-inserts.
     *
     * <p>Single transaction wraps the delete + the inserts so a crash mid-build
     * leaves the table consistent (empty), not partial.
     */
    @Transactional
    public IndexStats rebuild(UUID userId, UUID projectId) {
        long t0 = System.currentTimeMillis();
        Path root = storage.srcDir(userId, projectId).normalize();
        if (!Files.isDirectory(root)) {
            log.info("usage indexer: no src dir for project {}, skipping", projectId);
            return new IndexStats(0, 0, 0);
        }

        repo.deleteByProjectId(projectId);

        List<ProjectUsageRow> buffer = new ArrayList<>(50_000);
        int filesScanned = 0;
        long totalUsages = 0;

        try (Stream<Path> walk = Files.walk(root)) {
            Iterator<Path> iter = walk.filter(Files::isRegularFile)
                    .filter(p -> p.getFileName().toString().endsWith(".java"))
                    .limit(MAX_FILES)
                    .iterator();
            while (iter.hasNext()) {
                Path file = iter.next();
                try {
                    if (Files.size(file) > MAX_FILE_BYTES) continue;
                    String rel = root.relativize(file).toString().replace('\\', '/');
                    boolean isSdk = SdkPaths.isSdkPath(rel);
                    String content = Files.readString(file, StandardCharsets.UTF_8);
                    extractFromFile(content, rel, isSdk, buffer);
                    filesScanned++;

                    // Flush periodically so we don't hold the whole project in
                    // memory at once for huge trees.
                    if (buffer.size() >= 50_000) {
                        repo.bulkInsert(projectId, buffer);
                        totalUsages += buffer.size();
                        buffer.clear();
                    }
                } catch (MalformedInputException e) {
                    // non-UTF8 — skip
                } catch (IOException e) {
                    log.debug("usage indexer unreadable {}: {}", file, e.toString());
                }
            }
        } catch (IOException e) {
            log.warn("usage indexer walk failed: {}", e.toString());
        }

        if (!buffer.isEmpty()) {
            repo.bulkInsert(projectId, buffer);
            totalUsages += buffer.size();
        }
        long elapsed = System.currentTimeMillis() - t0;
        log.info("usage indexer: project {} indexed {} usages across {} files in {} ms",
                projectId, totalUsages, filesScanned, elapsed);
        return new IndexStats(filesScanned, totalUsages, elapsed);
    }

    /** Background re-index — used by the lazy fallback in findUsages so the
     *  first request only triggers a build, doesn't wait for it. */
    @Async("decompileExecutor")
    public void rebuildAsync(UUID userId, UUID projectId) {
        try {
            rebuild(userId, projectId);
        } catch (Exception e) {
            log.warn("async usage index rebuild failed for {}: {}", projectId, e.toString());
        }
    }

    public record IndexStats(int filesScanned, long usagesIndexed, long elapsedMs) {}

    /**
     * Scan one file: track class + method nesting via a brace-depth stack, then
     * emit a usage row for every call site. Approximate — string literals and
     * comments that contain braces can confuse the stack, but JADX output is
     * regular enough that errors are rare and localised.
     */
    private static void extractFromFile(String content, String rel, boolean isSdk, List<ProjectUsageRow> out) {
        String[] lines = content.split("\n", -1);

        // (className, methodName, depth) — depth is the brace-depth at the
        // moment we entered. We pop entries whose depth >= current depth.
        Deque<Scope> scopes = new ArrayDeque<>();
        int braceDepth = 0;

        // Dedup multiple identical hits on the same line (e.g. `foo(foo(x))`
        // → only record "foo" at this line once per kind).
        Set<String> lineSeen = new HashSet<>();
        int lastLineDeduped = -1;

        for (int i = 0; i < lines.length; i++) {
            int lineNum = i + 1;
            String line = lines[i];
            String stripped = stripStringsAndComments(line);

            if (lastLineDeduped != lineNum) {
                lineSeen.clear();
                lastLineDeduped = lineNum;
            }

            // ----- enclosing scope tracking -----
            // Update before processing call-sites on this line so a method's
            // own declaration line doesn't get attributed to its previous peer.
            Matcher cm = CLASS_DECL_FAST.matcher(stripped);
            if (cm.find()) {
                scopes.push(new Scope(cm.group(1), null, braceDepth));
            }
            Matcher mm = METHOD_DECL_FAST.matcher(stripped);
            if (mm.find()) {
                String mname = mm.group(1);
                if (!NON_CALLS.contains(mname)) {
                    String cls = scopes.isEmpty() ? "?" : scopes.peek().className;
                    scopes.push(new Scope(cls, mname, braceDepth));
                }
            }

            // ----- call sites on this line -----
            String enclosing = enclosingMethodOf(scopes);
            Matcher mc = METHOD_CALL.matcher(stripped);
            while (mc.find()) {
                String name = mc.group(1);
                if (NON_CALLS.contains(name)) continue;
                String dedupKey = "method:" + name;
                if (!lineSeen.add(dedupKey)) continue;
                out.add(new ProjectUsageRow(name, rel, lineNum, snippet(line), enclosing, isSdk, "method"));
            }
            Matcher mn = CTOR_CALL.matcher(stripped);
            while (mn.find()) {
                String name = mn.group(1);
                String dedupKey = "ctor:" + name;
                if (!lineSeen.add(dedupKey)) continue;
                out.add(new ProjectUsageRow(name, rel, lineNum, snippet(line), enclosing, isSdk, "ctor"));
            }
            Matcher mr = METHOD_REF.matcher(stripped);
            while (mr.find()) {
                String name = mr.group(1);
                if (NON_CALLS.contains(name)) continue;
                String dedupKey = "ref:" + name;
                if (!lineSeen.add(dedupKey)) continue;
                out.add(new ProjectUsageRow(name, rel, lineNum, snippet(line), enclosing, isSdk, "ref"));
            }

            // ----- update brace depth + pop scopes left behind -----
            for (int c = 0; c < stripped.length(); c++) {
                char ch = stripped.charAt(c);
                if (ch == '{') {
                    braceDepth++;
                } else if (ch == '}') {
                    braceDepth--;
                    while (!scopes.isEmpty() && scopes.peek().enteredAtDepth >= braceDepth) {
                        scopes.pop();
                    }
                }
            }
        }
    }

    /** Walk the scope stack from inside-out and return the first method scope.
     *  Returns {@code Class.method} formatted, or null if we're outside any
     *  indexed method (e.g. in a field initializer or top-level expression). */
    private static String enclosingMethodOf(Deque<Scope> scopes) {
        for (Scope s : scopes) {
            if (s.methodName != null) {
                return s.className + "." + s.methodName;
            }
        }
        return null;
    }

    /**
     * Drop double-quoted strings and `//...` line comments before applying the
     * call-site regexes. Without this, braces and call-shaped tokens inside
     * string literals corrupt the brace-depth tracker AND produce false-positive
     * usage rows. Crude — doesn't handle multi-line block comments or text
     * blocks, but JADX output is regular enough that those rarely appear.
     */
    private static String stripStringsAndComments(String line) {
        StringBuilder out = new StringBuilder(line.length());
        boolean inStr = false;
        boolean escape = false;
        for (int i = 0; i < line.length(); i++) {
            char c = line.charAt(i);
            if (inStr) {
                if (escape) { escape = false; continue; }
                if (c == '\\') { escape = true; continue; }
                if (c == '"') { inStr = false; out.append('"'); continue; }
                // swallow string contents — replace with space so column offsets stay close
                out.append(' ');
            } else {
                if (c == '"') { inStr = true; out.append('"'); continue; }
                if (c == '/' && i + 1 < line.length() && line.charAt(i + 1) == '/') {
                    break; // rest of line is a comment
                }
                out.append(c);
            }
        }
        return out.toString();
    }

    private static String snippet(String line) {
        String s = line.length() > 240 ? line.substring(0, 240) + "…" : line;
        return s.stripLeading();
    }

    private record Scope(String className, String methodName, int enteredAtDepth) {}
}
