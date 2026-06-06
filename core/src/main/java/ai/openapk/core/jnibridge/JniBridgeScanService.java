package ai.openapk.core.jnibridge;

import ai.openapk.core.auth.User;
import ai.openapk.core.jnibridge.dto.JniBridgeView;
import ai.openapk.core.jnibridge.dto.LibraryRef;
import ai.openapk.core.jnibridge.dto.LoaderCall;
import ai.openapk.core.jnibridge.dto.NativeMethodDecl;
import ai.openapk.core.nativeanalysis.NativeAnalysis;
import ai.openapk.core.nativeanalysis.NativeAnalysisJsonLoader;
import ai.openapk.core.nativeanalysis.NativeAnalysisRepository;
import ai.openapk.core.nativeanalysis.NativeAnalysisStatus;
import ai.openapk.core.projects.Project;
import ai.openapk.core.projects.ProjectRepository;
import ai.openapk.core.projects.storage.ProjectStorage;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.server.ResponseStatusException;

import java.io.IOException;
import java.nio.charset.MalformedInputException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Instant;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.HashSet;
import java.util.Iterator;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.TreeSet;
import java.util.UUID;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import java.util.stream.Stream;

/**
 * Bridges the Java ↔ Native gap. Scans the decompiled .java tree for three
 * things and writes them as one JSON doc to {@code projects.jni_bridge_jsonb}:
 *
 * <ol>
 *   <li><b>Native libraries</b> — every .so under resources/lib/&lt;abi&gt;/,
 *       grouped by short name (loadLibrary's argument), with archs and
 *       cross-referenced loader call sites</li>
 *   <li><b>Loader call sites</b> — every {@code System.loadLibrary("foo")},
 *       {@code System.load(...)}, or {@code Runtime.getRuntime().loadLibrary(...)}
 *       found in Java code</li>
 *   <li><b>Native method declarations</b> — every Java method with the
 *       {@code native} modifier, plus the JNI function it was matched to in
 *       one of the project's analyzed .so files (when a match exists)</li>
 * </ol>
 *
 * <p>JNI matching is intentionally simple for v1: builds
 * {@code Java_<package_with_underscores>_<class>_<method>} and looks it up
 * in the union of all READY native_analyses' function lists. Does NOT handle
 * underscore escaping ({@code _1} for literal {@code _}) or overload mangling
 * yet — those edge cases can be added when a real-world miss surfaces.
 *
 * <p>The scan is cheap (~kilobytes of output, single-digit seconds even for
 * large APKs) so we cache the whole result as one JSON doc on the project
 * row and recompute on Rescan or when a new lib finishes analysis.
 */
@Service
public class JniBridgeScanService {

    private static final Logger log = LoggerFactory.getLogger(JniBridgeScanService.class);

    private static final int MAX_FILES = 200_000;
    private static final long MAX_FILE_BYTES = 2L * 1024 * 1024;
    private static final String NATIVE_LIB_ROOT = "resources/lib";

    /** {@code System.loadLibrary("name")} or {@code System.load("path")} — captures method + literal. */
    private static final Pattern SYSTEM_LOAD = Pattern.compile(
            "\\bSystem\\s*\\.\\s*(loadLibrary|load)\\s*\\(\\s*\"([^\"]+)\"\\s*\\)"
    );

    /** {@code Runtime.getRuntime().loadLibrary("name")} (or .load(...)) — same shape, different prefix. */
    private static final Pattern RUNTIME_LOAD = Pattern.compile(
            "\\bRuntime\\s*\\.\\s*getRuntime\\s*\\(\\s*\\)\\s*\\.\\s*(loadLibrary|load)\\s*\\(\\s*\"([^\"]+)\"\\s*\\)"
    );

    /**
     * Java {@code native} method declaration. Modifier order is loose ("public
     * static native", "native public", etc.). We capture the method name —
     * the enclosing class comes from a brace-depth pre-pass on the file.
     * Filters out {@code native} as part of a string or identifier via a
     * non-word boundary on each side.
     */
    private static final Pattern NATIVE_METHOD = Pattern.compile(
            "(?:^|[^\\w])native\\s+[\\w<>\\[\\],?\\s.@]+?\\s+(\\w+)\\s*\\([^;{]*\\)\\s*(?:throws[^;{]*)?\\s*;"
    );

    /** Package declaration — captures fully-qualified package. */
    private static final Pattern PACKAGE_DECL = Pattern.compile(
            "^\\s*package\\s+([\\w.]+)\\s*;",
            Pattern.MULTILINE
    );

    /** Class / interface / enum declaration — captures the name. Used to track
     *  the innermost enclosing class while scanning. */
    private static final Pattern TYPE_DECL = Pattern.compile(
            "\\b(?:class|interface|enum)\\s+(\\w+)"
    );

    private final ProjectRepository projectRepo;
    private final NativeAnalysisRepository nativeRepo;
    private final NativeAnalysisJsonLoader nativeJsonLoader;
    private final ProjectStorage storage;
    private final ObjectMapper objectMapper;

    public JniBridgeScanService(
            ProjectRepository projectRepo,
            NativeAnalysisRepository nativeRepo,
            NativeAnalysisJsonLoader nativeJsonLoader,
            ProjectStorage storage,
            ObjectMapper objectMapper
    ) {
        this.projectRepo = projectRepo;
        this.nativeRepo = nativeRepo;
        this.nativeJsonLoader = nativeJsonLoader;
        this.storage = storage;
        this.objectMapper = objectMapper;
    }

    /**
     * Return the cached scan if present, otherwise run one and persist it.
     * Use {@link #rescan} to force a refresh.
     */
    @Transactional
    public JniBridgeView getOrBuild(User user, UUID projectId) {
        Project p = requireOwned(user, projectId);
        String cached = p.getJniBridgeJson();
        if (cached != null && !cached.isBlank()) {
            try {
                return objectMapper.readValue(cached, JniBridgeView.class);
            } catch (Exception e) {
                log.warn("jni bridge cache for {} is unreadable, rebuilding: {}", projectId, e.toString());
            }
        }
        return buildAndPersist(user, p);
    }

    /** Force a fresh scan, overwriting any cached doc. */
    @Transactional
    public JniBridgeView rescan(User user, UUID projectId) {
        Project p = requireOwned(user, projectId);
        return buildAndPersist(user, p);
    }

    // ---------- internals ----------

    private JniBridgeView buildAndPersist(User user, Project p) {
        UUID projectId = p.getId();
        Path root = storage.srcDir(user.getId(), projectId).normalize();

        long start = System.currentTimeMillis();
        List<LoaderCall> loaders = new ArrayList<>();
        List<NativeMethodDecl> nativeMethods = new ArrayList<>();
        scanJavaTree(root, loaders, nativeMethods);

        // Cross-reference native methods against analyzed .so function lists.
        Map<String, String[]> jniNameToLoc = buildJniIndex(projectId);
        for (int i = 0; i < nativeMethods.size(); i++) {
            NativeMethodDecl m = nativeMethods.get(i);
            String[] loc = jniNameToLoc.get(m.expectedJniName());
            if (loc != null) {
                nativeMethods.set(i, new NativeMethodDecl(
                        m.file(), m.line(), m.className(), m.packageName(),
                        m.methodName(), m.signature(), m.expectedJniName(),
                        loc[0], loc[1]
                ));
            }
        }

        // Group .so files by short name and cross-reference loaders.
        List<LibraryRef> libraries = buildLibraryRefs(root, loaders);

        JniBridgeView view = new JniBridgeView(libraries, loaders, nativeMethods, Instant.now());
        try {
            p.setJniBridgeJson(objectMapper.writeValueAsString(view));
            projectRepo.save(p);
        } catch (Exception e) {
            log.warn("jni bridge persist failed for {}: {}", projectId, e.toString());
        }
        log.info("jni bridge scan project={} libs={} loaders={} natives={} matches={} in {} ms",
                projectId, libraries.size(), loaders.size(), nativeMethods.size(),
                nativeMethods.stream().filter(m -> m.matchedLibPath() != null).count(),
                System.currentTimeMillis() - start);
        return view;
    }

    private void scanJavaTree(Path root, List<LoaderCall> loaders, List<NativeMethodDecl> nativeMethods) {
        if (!Files.isDirectory(root)) return;
        int filesScanned = 0;
        try (Stream<Path> walk = Files.walk(root)) {
            Iterator<Path> it = walk.filter(Files::isRegularFile)
                    .filter(p -> p.getFileName().toString().endsWith(".java"))
                    .iterator();
            while (it.hasNext() && filesScanned < MAX_FILES) {
                Path p = it.next();
                long sz;
                try { sz = Files.size(p); } catch (IOException e) { continue; }
                if (sz > MAX_FILE_BYTES) continue;
                String raw;
                try {
                    raw = Files.readString(p, StandardCharsets.UTF_8);
                } catch (MalformedInputException | java.nio.charset.UnmappableCharacterException e) {
                    continue;
                } catch (IOException e) {
                    log.debug("scan read fail {}: {}", p, e.toString());
                    continue;
                }
                String rel = root.relativize(p).toString().replace('\\', '/');
                scanOneFile(rel, raw, loaders, nativeMethods);
                filesScanned++;
            }
        } catch (IOException e) {
            log.warn("jni bridge tree walk failed for {}: {}", root, e.toString());
        }
        log.debug("jni bridge scanned {} java files under {}", filesScanned, root);
    }

    private void scanOneFile(String relPath, String raw, List<LoaderCall> loaders, List<NativeMethodDecl> nativeMethods) {
        // Strip comments + strings to avoid false positives. We DO need string
        // literals back for the loader regex (the lib name is INSIDE a string),
        // so we scan loaders on the original source first, then native-method
        // declarations on the stripped source.
        Matcher pkgM = PACKAGE_DECL.matcher(raw);
        String packageName = pkgM.find() ? pkgM.group(1) : "";

        scanLoaders(relPath, raw, loaders);

        String stripped = stripCommentsAndStrings(raw);
        scanNativeMethods(relPath, stripped, raw, packageName, nativeMethods);
    }

    private void scanLoaders(String relPath, String raw, List<LoaderCall> loaders) {
        emitLoaderMatches(relPath, raw, SYSTEM_LOAD, loaders);
        emitLoaderMatches(relPath, raw, RUNTIME_LOAD, loaders);
    }

    private void emitLoaderMatches(String relPath, String raw, Pattern p, List<LoaderCall> out) {
        Matcher m = p.matcher(raw);
        while (m.find()) {
            int offset = m.start();
            int line = lineNumberAt(raw, offset);
            String snippet = extractLine(raw, offset).trim();
            out.add(new LoaderCall(relPath, line, m.group(1), m.group(2), snippet));
        }
    }

    private record TypeAt(int offset, String name) {}

    /**
     * Walks the stripped source, tracking enclosing-class context via brace
     * depth. When a {@code native} method declaration is seen, the innermost
     * type on the stack is its class.
     */
    private void scanNativeMethods(
            String relPath,
            String stripped,
            String raw,
            String packageName,
            List<NativeMethodDecl> out
    ) {
        Matcher typeM = TYPE_DECL.matcher(stripped);
        Matcher methM = NATIVE_METHOD.matcher(stripped);

        List<TypeAt> types = new ArrayList<>();
        while (typeM.find()) types.add(new TypeAt(typeM.start(), typeM.group(1)));

        while (methM.find()) {
            int offset = methM.start();
            String methodName = methM.group(1);
            String className = enclosingType(types, offset, stripped);
            if (className == null) continue;
            int line = lineNumberAt(raw, offset);
            String snippet = extractLine(raw, offset).trim();
            String jni = buildJniName(packageName, className, methodName);
            out.add(new NativeMethodDecl(
                    relPath, line, className, packageName, methodName,
                    snippet, jni, null, null
            ));
        }
    }

    /**
     * Find the innermost type whose declaration appears BEFORE {@code offset}
     * and whose body still encloses it (brace depth > 0 between type-decl and
     * offset). Quick-and-dirty: the deepest matching type-decl is usually
     * right for decompiled Java, which doesn't tend to declare methods inside
     * method bodies. Brace counting falls back when a method-decl sits past
     * the end of an inner class.
     */
    private static String enclosingType(List<TypeAt> types, int offset, String source) {
        String last = null;
        for (TypeAt t : types) {
            if (t.offset() >= offset) break;
            if (braceDepthBetween(source, t.offset(), offset) > 0) {
                last = t.name();
            }
        }
        return last;
    }

    private static int braceDepthBetween(String s, int from, int to) {
        int depth = 0;
        for (int i = from; i < to && i < s.length(); i++) {
            char c = s.charAt(i);
            if (c == '{') depth++;
            else if (c == '}') depth--;
        }
        return depth;
    }

    /**
     * Compute the JNI symbol Java would generate for this method's short form:
     *   Java_<package_underscored>_<class>_<method>
     * Does not handle underscore escaping (_1) or overload mangling (__) yet.
     */
    private static String buildJniName(String packageName, String className, String methodName) {
        StringBuilder sb = new StringBuilder("Java_");
        if (!packageName.isBlank()) {
            sb.append(packageName.replace('.', '_')).append('_');
        }
        sb.append(className).append('_').append(methodName);
        return sb.toString();
    }

    /**
     * Build {@code jniName → [libPath, address]} over every READY native
     * analysis in this project. Address is the immutable identity, kept
     * around so the UI can jump straight to the function (when we polish
     * the direct-navigation path).
     */
    private Map<String, String[]> buildJniIndex(UUID projectId) {
        Map<String, String[]> out = new HashMap<>();
        for (NativeAnalysis na : nativeRepo.findAllByProjectId(projectId)) {
            if (na.getStatus() != NativeAnalysisStatus.READY) continue;
            String json = nativeJsonLoader.load(na);
            if (json == null || json.isBlank()) continue;
            try {
                JsonNode root = objectMapper.readTree(json);
                JsonNode functions = root.get("functions");
                if (functions == null || !functions.isArray()) continue;
                for (JsonNode fn : functions) {
                    JsonNode nameN = fn.get("name");
                    JsonNode addrN = fn.get("address");
                    if (nameN == null) continue;
                    String name = nameN.asString("");
                    if (!name.startsWith("Java_")) continue;
                    // First library to define wins; collisions across libs are rare and
                    // overwriting would lose the original match.
                    if (!out.containsKey(name)) {
                        out.put(name, new String[]{ na.getLibPath(), addrN != null ? addrN.asString(null) : null });
                    }
                }
            } catch (Exception e) {
                log.debug("jni index parse fail for {}: {}", na.getLibPath(), e.toString());
            }
        }
        return out;
    }

    private List<LibraryRef> buildLibraryRefs(Path root, List<LoaderCall> loaders) {
        Path libRoot = root.resolve(NATIVE_LIB_ROOT);
        if (!Files.isDirectory(libRoot)) return List.of();

        // shortName ("crypto") → (paths, archs)
        Map<String, List<String>> paths = new LinkedHashMap<>();
        Map<String, Set<String>> archs = new LinkedHashMap<>();
        try (Stream<Path> walk = Files.walk(libRoot, 3)) {
            Iterator<Path> it = walk.filter(Files::isRegularFile)
                    .filter(p -> p.getFileName().toString().endsWith(".so"))
                    .iterator();
            while (it.hasNext()) {
                Path p = it.next();
                String rel = root.relativize(p).toString().replace('\\', '/');
                String filename = p.getFileName().toString();
                String shortName = filename.startsWith("lib")
                        ? filename.substring(3, filename.length() - 3)
                        : filename.substring(0, filename.length() - 3);
                String arch = inferArch(rel);
                paths.computeIfAbsent(shortName, k -> new ArrayList<>()).add(rel);
                archs.computeIfAbsent(shortName, k -> new TreeSet<>()).add(arch);
            }
        } catch (IOException e) {
            log.warn("lib walk failed under {}: {}", libRoot, e.toString());
            return List.of();
        }

        // Map each loader's target to its index in the loaders[] array, so
        // every LibraryRef can carry pointers rather than copies. We match on
        // BOTH the loadLibrary short name AND the basename of any absolute
        // path passed to System.load("/data/.../libfoo.so").
        Set<String> known = paths.keySet();
        Map<String, List<Integer>> loaderIdxByShort = new HashMap<>();
        for (int i = 0; i < loaders.size(); i++) {
            LoaderCall lc = loaders.get(i);
            String resolved = resolveLoaderShortName(lc.target(), known);
            if (resolved == null) continue;
            loaderIdxByShort.computeIfAbsent(resolved, k -> new ArrayList<>()).add(i);
        }

        List<LibraryRef> out = new ArrayList<>();
        for (Map.Entry<String, List<String>> e : paths.entrySet()) {
            String shortName = e.getKey();
            out.add(new LibraryRef(
                    shortName,
                    List.copyOf(e.getValue()),
                    List.copyOf(archs.get(shortName)),
                    List.copyOf(loaderIdxByShort.getOrDefault(shortName, List.of()))
            ));
        }
        return out;
    }

    /**
     * Reduce a loader target to a known short name, or null if it doesn't
     * match anything we found on disk.
     *
     * <ul>
     *   <li>"crypto" — already a short name, accept if known</li>
     *   <li>"/data/data/.../libcrypto.so" — strip path + lib + .so, accept if known</li>
     *   <li>"libcrypto.so" — strip lib + .so, accept if known</li>
     * </ul>
     */
    private static String resolveLoaderShortName(String target, Set<String> known) {
        if (target == null || target.isBlank()) return null;
        if (known.contains(target)) return target;
        String basename = target;
        int slash = Math.max(basename.lastIndexOf('/'), basename.lastIndexOf('\\'));
        if (slash >= 0) basename = basename.substring(slash + 1);
        if (basename.endsWith(".so")) basename = basename.substring(0, basename.length() - 3);
        if (basename.startsWith("lib")) basename = basename.substring(3);
        return known.contains(basename) ? basename : null;
    }

    private static String inferArch(String relPath) {
        String[] parts = relPath.split("/");
        if (parts.length >= 4 && "resources".equals(parts[0]) && "lib".equals(parts[1])) {
            return parts[2];
        }
        return "unknown";
    }

    // ---------- text utilities ----------

    /**
     * Replace comment and string-literal contents with spaces, preserving
     * line offsets so line numbers computed against the stripped source
     * still align with the original. Same approach as
     * {@link ai.openapk.core.symbols.usages.UsageIndexerService}.
     */
    private static String stripCommentsAndStrings(String src) {
        char[] out = src.toCharArray();
        int i = 0, n = out.length;
        while (i < n) {
            char c = out[i];
            if (c == '/' && i + 1 < n && out[i + 1] == '/') {
                while (i < n && out[i] != '\n') { out[i] = ' '; i++; }
            } else if (c == '/' && i + 1 < n && out[i + 1] == '*') {
                out[i++] = ' '; out[i++] = ' ';
                while (i < n) {
                    char x = out[i];
                    if (x == '*' && i + 1 < n && out[i + 1] == '/') {
                        out[i++] = ' '; out[i++] = ' '; break;
                    }
                    if (x != '\n') out[i] = ' ';
                    i++;
                }
            } else if (c == '"') {
                out[i++] = ' ';
                while (i < n) {
                    char x = out[i];
                    if (x == '\\' && i + 1 < n) { out[i++] = ' '; out[i++] = ' '; continue; }
                    if (x == '"') { out[i++] = ' '; break; }
                    if (x != '\n') out[i] = ' ';
                    i++;
                }
            } else if (c == '\'') {
                out[i++] = ' ';
                while (i < n) {
                    char x = out[i];
                    if (x == '\\' && i + 1 < n) { out[i++] = ' '; out[i++] = ' '; continue; }
                    if (x == '\'') { out[i++] = ' '; break; }
                    if (x != '\n') out[i] = ' ';
                    i++;
                }
            } else {
                i++;
            }
        }
        return new String(out);
    }

    private static int lineNumberAt(String s, int offset) {
        int line = 1;
        int max = Math.min(offset, s.length());
        for (int i = 0; i < max; i++) {
            if (s.charAt(i) == '\n') line++;
        }
        return line;
    }

    private static String extractLine(String s, int offset) {
        int start = offset;
        while (start > 0 && s.charAt(start - 1) != '\n') start--;
        int end = offset;
        while (end < s.length() && s.charAt(end) != '\n') end++;
        return s.substring(start, end);
    }

    private Project requireOwned(User user, UUID projectId) {
        return projectRepo.findByIdAndUserId(projectId, user.getId())
                .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND, "project not found"));
    }
}
