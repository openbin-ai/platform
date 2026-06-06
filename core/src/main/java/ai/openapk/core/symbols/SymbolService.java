package ai.openapk.core.symbols;

import ai.openapk.core.auth.User;
import ai.openapk.core.projects.Project;
import ai.openapk.core.projects.ProjectAccessGuard;
import ai.openapk.core.projects.ProjectRepository;
import ai.openapk.core.projects.storage.ProjectStorage;
import ai.openapk.core.renames.RenameService;
import ai.openapk.core.symbols.dto.Symbol;
import ai.openapk.core.symbols.dto.SymbolIndex;
import ai.openapk.core.symbols.dto.SymbolKind;
import ai.openapk.core.symbols.dto.SymbolUsage;
import ai.openapk.core.symbols.usages.ProjectUsageRepository;
import ai.openapk.core.symbols.usages.ProjectUsageRow;
import ai.openapk.core.symbols.usages.UsageIndexerService;
import ai.openapk.core.util.SdkPaths;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.server.ResponseStatusException;
import tools.jackson.databind.ObjectMapper;

import java.io.IOException;
import java.nio.charset.MalformedInputException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Instant;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.Iterator;
import java.util.List;
import java.util.Set;
import java.util.UUID;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import java.util.stream.Stream;

/**
 * Coarse symbol index for the decompiled tree. v1 scope:
 *
 * - Declarations only (CLASS / INTERFACE / ENUM / METHOD). No fields, no
 *   constructors — researchers want to hop between methods, that's the priority.
 * - Owner-class is approximated by the FILE'S basename. Inner classes inherit
 *   their outer class's attribution. False positives accepted.
 * - Usages are NOT indexed; {@link #findUsages} live-greps every call.
 *
 * Built lazily on first query, persisted as JSON on the Project row, and
 * rebuildable via {@link #rebuild}.
 */
@Service
public class SymbolService {

    private static final Logger log = LoggerFactory.getLogger(SymbolService.class);

    private static final int MAX_FILES = 30_000;
    private static final long MAX_FILE_BYTES = 1024 * 1024;
    private static final int MAX_USAGES = 500;

    // Line-anchored: kind (group 1) + simple name (group 2). Modifiers/generics consumed loosely.
    private static final Pattern CLASS_DECL = Pattern.compile(
            "^\\s*(?:(?:public|private|protected|abstract|final|static|sealed|non-sealed)\\s+)*(class|interface|enum)\\s+(\\w+)"
    );

    // Method declaration ending in `{` (concrete) or `;` (abstract / interface).
    // Skips constructors (no return type) and common false positives via post-filter.
    private static final Pattern METHOD_DECL = Pattern.compile(
            "^\\s*(?:(?:public|private|protected|static|final|synchronized|abstract|native|default|strictfp)\\s+)+" +
            "([\\w<>\\[\\]?,.\\s$]+?)\\s+(\\w+)\\s*\\(([^)]*)\\)\\s*(?:throws[^{;]*)?[{;]"
    );

    /** Constructor declaration: requires at least one access modifier, the
     *  identifier matches the enclosing class name, and there's no return-type
     *  token between the modifiers and the parens. Caller validates name == class. */
    private static final Pattern CTOR_DECL = Pattern.compile(
            "^\\s*(?:(?:public|private|protected)\\s+)+(\\w+)\\s*\\(([^)]*)\\)\\s*(?:throws[^{]*)?\\{"
    );

    /** Field declaration: `[mods] Type name [= ...];` — Type may contain
     *  generics, arrays, and inner-class dots. Restricted to lines that end
     *  in `;` (so we don't match locals inside method bodies — those don't
     *  appear at depth 0 of the class either, but the brace tracker handles
     *  that). */
    private static final Pattern FIELD_DECL = Pattern.compile(
            "^\\s*(?:(?:public|private|protected|static|final|volatile|transient)\\s+)+" +
            "([\\w<>\\[\\]?,.\\s$]+?)\\s+(\\w+)\\s*(?:=[^;]*)?;"
    );

    private static final Set<String> CONTROL_FLOW = Set.of(
            "if", "for", "while", "switch", "catch", "return", "new", "synchronized", "try", "do", "else"
    );

    private static final Pattern PACKAGE_DECL = Pattern.compile("^\\s*package\\s+([\\w.]+)\\s*;");
    private static final Pattern IMPORT_DECL = Pattern.compile(
            "^\\s*import\\s+(?:static\\s+)?([\\w.]+(?:\\.\\*)?)\\s*;"
    );

    private final ProjectRepository projectRepo;
    private final ProjectStorage storage;
    private final RenameService renameService;
    private final ObjectMapper mapper;
    private final ProjectUsageRepository usageRepo;
    private final UsageIndexerService usageIndexer;
    private final ProjectAccessGuard guard;

    public SymbolService(
            ProjectRepository projectRepo,
            ProjectStorage storage,
            RenameService renameService,
            ObjectMapper mapper,
            ProjectUsageRepository usageRepo,
            UsageIndexerService usageIndexer,
            ProjectAccessGuard guard
    ) {
        this.projectRepo = projectRepo;
        this.storage = storage;
        this.renameService = renameService;
        this.mapper = mapper;
        this.usageRepo = usageRepo;
        this.usageIndexer = usageIndexer;
        this.guard = guard;
    }

    /**
     * Read the cached SymbolIndex wrapped in a {@link LookupIndex} for O(1)
     * by-name lookups. Caller pays the small map-build cost once and amortises
     * it across many recursive lookups (call chain construction, symbol panel
     * usages query, etc.).
     */
    @Transactional
    public LookupIndex getOrBuildLookup(User user, UUID projectId) {
        return new LookupIndex(getOrBuild(user, projectId));
    }

    /** Read cached index, building lazily if missing. */
    @Transactional
    public SymbolIndex getOrBuild(User user, UUID projectId) {
        Project p = loadProject(user, projectId);
        if (p.getSymbolIndexJson() != null && !p.getSymbolIndexJson().isBlank()) {
            try {
                return mapper.readValue(p.getSymbolIndexJson(), SymbolIndex.class);
            } catch (Exception e) {
                log.warn("symbol index parse failed for project {}, rebuilding: {}", projectId, e.toString());
            }
        }
        return rebuild(user, projectId);
    }

    /** Force a rebuild and persist. */
    @Transactional
    public SymbolIndex rebuild(User user, UUID projectId) {
        Project p = loadProject(user, projectId);
        // Owner-keyed srcDir so collaborators rebuild over the project owner's workspace.
        Path root = storage.srcDir(p.getUser().getId(), projectId).normalize();
        if (!Files.isDirectory(root)) {
            SymbolIndex empty = new SymbolIndex(Instant.now(), 0, List.of());
            persist(p, empty);
            return empty;
        }
        List<Symbol> symbols = new ArrayList<>();
        int files = 0;
        try (Stream<Path> walk = Files.walk(root)) {
            Iterator<Path> iter = walk.filter(Files::isRegularFile)
                    .filter(pp -> pp.getFileName().toString().endsWith(".java"))
                    .limit(MAX_FILES)
                    .iterator();
            while (iter.hasNext()) {
                Path file = iter.next();
                String rel = root.relativize(file).toString().replace('\\', '/');
                try {
                    if (Files.size(file) > MAX_FILE_BYTES) continue;
                    String content = Files.readString(file, StandardCharsets.UTF_8);
                    // Index the rename-rewritten view so symbol names match
                    // what the user sees in the viewer.
                    content = renameService.applyMapToContent(projectId, content);
                    extractFromContent(content, rel, symbols);
                    files++;
                } catch (MalformedInputException e) {
                    // non-UTF8, skip
                } catch (IOException e) {
                    log.debug("symbol scan unreadable {}: {}", file, e.toString());
                }
            }
        } catch (IOException e) {
            log.warn("symbol scan walk failed: {}", e.toString());
        }
        SymbolIndex index = new SymbolIndex(Instant.now(), files, symbols);
        persist(p, index);
        log.info("symbol index built for project {}: {} symbols across {} files", projectId, symbols.size(), files);
        return index;
    }

    private void persist(Project p, SymbolIndex index) {
        try {
            p.setSymbolIndexJson(mapper.writeValueAsString(index));
            projectRepo.save(p);
        } catch (Exception e) {
            throw new ResponseStatusException(HttpStatus.INTERNAL_SERVER_ERROR, "failed to persist symbol index", e);
        }
    }

    private static void extractFromContent(String content, String rel, List<Symbol> out) {
        // Derive a fallback class name from the file path basename for early
        // lines that appear before any explicit declaration.
        int slash = rel.lastIndexOf('/');
        String baseName = slash >= 0 ? rel.substring(slash + 1) : rel;
        String fileClassFallback = baseName.endsWith(".java") ? baseName.substring(0, baseName.length() - 5) : baseName;

        List<String> lines = List.of(content.split("\n", -1));
        String currentClass = fileClassFallback;
        String pkg = parsePackage(lines);
        int outerDepth = -1;
        int braceDepth = 0;

        for (int i = 0; i < lines.size(); i++) {
            String line = lines.get(i);
            int lineNum = i + 1;

            Matcher cm = CLASS_DECL.matcher(line);
            if (cm.find()) {
                String kindStr = cm.group(1);
                String name = cm.group(2);
                SymbolKind kind = switch (kindStr) {
                    case "interface" -> SymbolKind.INTERFACE;
                    case "enum" -> SymbolKind.ENUM;
                    default -> SymbolKind.CLASS;
                };
                out.add(new Symbol(kind, name, name, rel, lineNum, "", modifiersFromLine(line, kindStr), pkg));
                // The outermost top-level class is the first one whose declaration
                // appears at depth 0. Attribute method declarations to it.
                if (outerDepth == -1) {
                    currentClass = name;
                    outerDepth = braceDepth;
                }
            } else {
                Matcher mm = METHOD_DECL.matcher(line);
                if (mm.find()) {
                    String name = mm.group(2);
                    String params = mm.group(3);
                    String retType = mm.group(1).trim();
                    if (CONTROL_FLOW.contains(name)) {
                        // skip
                    } else if (name.equals(currentClass)) {
                        // METHOD_DECL captures `Foo Foo(args) {` where the
                        // "return type" is actually the modifier sequence —
                        // shouldn't fire often, but fall through to CTOR_DECL.
                    } else {
                        out.add(new Symbol(
                                SymbolKind.METHOD,
                                name,
                                currentClass,
                                rel,
                                lineNum,
                                "(" + params.trim() + ")",
                                retType,
                                pkg
                        ));
                    }
                } else {
                    // Constructor — same shape as a method but no return type.
                    Matcher cmc = CTOR_DECL.matcher(line);
                    if (cmc.find()) {
                        String name = cmc.group(1);
                        String params = cmc.group(2);
                        // Only treat as ctor when the name matches the enclosing
                        // class — otherwise it's likely a return-type-less helper
                        // (unusual but the false positive isn't worth the noise).
                        if (name.equals(currentClass)) {
                            out.add(new Symbol(
                                    SymbolKind.CONSTRUCTOR,
                                    name,
                                    currentClass,
                                    rel,
                                    lineNum,
                                    "(" + params.trim() + ")",
                                    "",
                                    pkg
                            ));
                        }
                    } else {
                        // Field declaration — only meaningful inside a class
                        // body (not inside a method body). We approximate by
                        // requiring brace depth > 0 (inside the class) and
                        // not deeper than the outer class (still at field
                        // level, not inside a method).
                        if (braceDepth > outerDepth && braceDepth <= outerDepth + 1) {
                            Matcher fm = FIELD_DECL.matcher(line);
                            if (fm.find()) {
                                String name = fm.group(2);
                                String type = fm.group(1).trim();
                                if (!CONTROL_FLOW.contains(name) && !name.equals(currentClass)) {
                                    out.add(new Symbol(
                                            SymbolKind.FIELD,
                                            name,
                                            currentClass,
                                            rel,
                                            lineNum,
                                            "",
                                            type,
                                            pkg
                                    ));
                                }
                            }
                        }
                    }
                }
            }

            braceDepth += countChar(line, '{') - countChar(line, '}');
        }
    }

    /** First `package x.y;` declaration in the file, or "" for the unnamed package. */
    private static String parsePackage(List<String> lines) {
        for (String line : lines) {
            // Stop scanning once we've clearly entered the body — package decls
            // must be the first non-comment statement.
            if (line.contains("class ") || line.contains("interface ") || line.contains("enum ")) break;
            Matcher m = PACKAGE_DECL.matcher(line);
            if (m.find()) return m.group(1);
        }
        return "";
    }

    /** Every `import …;` statement in the file, in source order. */
    private static List<String> parseImports(List<String> lines) {
        List<String> imports = new ArrayList<>();
        for (String line : lines) {
            if (line.contains("class ") || line.contains("interface ") || line.contains("enum ")) break;
            Matcher m = IMPORT_DECL.matcher(line);
            if (m.find()) imports.add(m.group(1));
        }
        return imports;
    }

    /**
     * Whether a file (with its package + import list) can see a declaration in
     * {@code defPkg} with simple name {@code defName}. Java visibility rules
     * (without resolving FQNs): same package, or explicit import, or wildcard
     * import of the package.
     */
    private static boolean isVisibleFrom(String filePkg, List<String> imports, String defPkg, String defName) {
        if (filePkg.equals(defPkg)) return true;
        // java.lang.* is implicit in every file.
        if ("java.lang".equals(defPkg)) return true;
        String fqn = defPkg.isEmpty() ? defName : defPkg + "." + defName;
        String wild = defPkg.isEmpty() ? null : defPkg + ".*";
        for (String imp : imports) {
            if (imp.equals(fqn)) return true;
            if (wild != null && imp.equals(wild)) return true;
        }
        return false;
    }

    private static int countChar(String s, char c) {
        int n = 0;
        for (int i = 0; i < s.length(); i++) if (s.charAt(i) == c) n++;
        return n;
    }

    private static String modifiersFromLine(String line, String kindKeyword) {
        int idx = line.indexOf(kindKeyword);
        if (idx <= 0) return "";
        return line.substring(0, idx).trim();
    }

    /** Resolve a bare identifier to declarations. May return multiple (homonyms across classes). */
    @Transactional
    public List<Symbol> findDefinitions(User user, UUID projectId, String name, boolean includeSdks) {
        if (name == null || name.isBlank()) return List.of();
        LookupIndex lookup = getOrBuildLookup(user, projectId);
        List<Symbol> matches = new ArrayList<>();
        for (Symbol s : lookup.byName(name)) {
            if (!includeSdks && SdkPaths.isSdkPath(s.file())) continue;
            matches.add(s);
        }
        return matches;
    }

    /**
     * Find call-sites of an identifier. Fast path: the persistent
     * {@code project_usages} index (built once at decompile time). Slow path:
     * live grep across the tree (used for legacy projects from before V13
     * and kicks off an async re-index so the next call is fast).
     *
     * <p>Rename-aware: if the caller searches for a name that the user has
     * renamed, we translate to the raw (pre-rename) name for the index lookup,
     * then rewrite snippets back to the renamed view for display.
     */
    @Transactional(readOnly = true)
    public List<SymbolUsage> findUsages(
            User user, UUID projectId, String name,
            String qualifyingClass, String excludeFile, int excludeLine,
            boolean includeSdks
    ) {
        if (name == null || name.isBlank()) return List.of();
        Project project = loadProject(user, projectId);

        // ----- DB-backed fast path ------------------------------------------
        if (usageRepo.hasAnyRows(projectId)) {
            return findUsagesFromIndex(projectId, name, qualifyingClass, excludeFile, excludeLine, includeSdks);
        }

        // ----- legacy fallback: live grep + lazy build ----------------------
        // First request triggers an async re-index so the next one is fast.
        // The current request still uses the slow path so the user doesn't
        // block on a 1-2 minute index build. Owner-keyed so collaborator
        // requests index the project owner's workspace.
        UUID ownerId = project.getUser().getId();
        usageIndexer.rebuildAsync(ownerId, projectId);

        Path root = storage.srcDir(ownerId, projectId).normalize();
        if (!Files.isDirectory(root)) return List.of();

        // Look up the declaration packages for this name. If we have any, we
        // can scope usages to files that can actually "see" those declarations
        // (same package or matching import). If the name isn't in the index,
        // fall back to the global SDK-filtered behavior.
        SymbolIndex idx = getOrBuild(user, projectId);
        Set<String> defPackages = new HashSet<>();
        for (Symbol s : idx.symbols()) {
            if (!s.name().equals(name)) continue;
            if (!includeSdks && SdkPaths.isSdkPath(s.file())) continue;
            defPackages.add(s.pkg() == null ? "" : s.pkg());
        }

        Pattern pattern = qualifyingClass != null && !qualifyingClass.isBlank()
                ? Pattern.compile("\\b" + Pattern.quote(qualifyingClass) + "\\s*\\.\\s*" + Pattern.quote(name) + "\\b")
                : Pattern.compile("\\b" + Pattern.quote(name) + "\\b");

        List<SymbolUsage> hits = new ArrayList<>();
        try (Stream<Path> walk = Files.walk(root)) {
            Iterator<Path> iter = walk.filter(Files::isRegularFile)
                    .filter(p -> p.getFileName().toString().endsWith(".java"))
                    .filter(p -> includeSdks || !SdkPaths.isSdkPath(root.relativize(p).toString()))
                    .limit(MAX_FILES)
                    .iterator();
            while (iter.hasNext() && hits.size() < MAX_USAGES) {
                Path p = iter.next();
                String rel = root.relativize(p).toString().replace('\\', '/');
                try {
                    if (Files.size(p) > MAX_FILE_BYTES) continue;
                    String content = Files.readString(p, StandardCharsets.UTF_8);
                    content = renameService.applyMapToContent(projectId, content);
                    String[] lines = content.split("\n", -1);
                    List<String> lineList = List.of(lines);

                    // Skip files where none of the candidate declaration packages
                    // are visible — Java's package + import rules, plus the
                    // fully-qualified reference fallback (callers can write
                    // `defpackage.b.d()` with no import; JADX often does this).
                    if (!defPackages.isEmpty()) {
                        String filePkg = parsePackage(lineList);
                        List<String> fileImports = parseImports(lineList);
                        boolean visible = false;
                        for (String defPkg : defPackages) {
                            if (isVisibleFrom(filePkg, fileImports, defPkg, name)) {
                                visible = true;
                                break;
                            }
                            // FQN fallback: e.g. `defpackage.b.d()` or `extends defpackage.b`
                            // with no import statement. Cheap substring check; the
                            // regex pass below still has to find a real usage.
                            if (!defPkg.isEmpty() && content.contains(defPkg + "." + name)) {
                                visible = true;
                                break;
                            }
                        }
                        if (!visible) continue;
                    }

                    for (int i = 0; i < lines.length && hits.size() < MAX_USAGES; i++) {
                        int lineNum = i + 1;
                        if (rel.equals(excludeFile) && lineNum == excludeLine) continue;
                        String line = lines[i];
                        if (pattern.matcher(line).find()) {
                            hits.add(new SymbolUsage(rel, lineNum, snippet(line)));
                        }
                    }
                } catch (MalformedInputException e) {
                    // skip
                } catch (IOException e) {
                    log.debug("usage scan unreadable {}: {}", p, e.toString());
                }
            }
        } catch (IOException e) {
            log.warn("usage walk failed: {}", e.toString());
        }
        return hits;
    }

    private static String snippet(String line) {
        String s = line.length() > 240 ? line.substring(0, 240) + "…" : line;
        return s.stripLeading();
    }

    /**
     * Fast path for {@link #findUsages} backed by the {@code project_usages}
     * table. Translates the searched name through the rename map so a query
     * for the renamed identifier still hits the raw rows indexed at decompile
     * time, then rewrites snippets back to the renamed view for display.
     *
     * <p>The qualifyingClass filter from the live-grep path is best-effort
     * here: we apply it as an extra regex over the returned snippets rather
     * than at SQL level. The DB query is cheap enough that the extra round
     * of filtering doesn't matter.
     */
    private List<SymbolUsage> findUsagesFromIndex(
            UUID projectId, String name,
            String qualifyingClass, String excludeFile, int excludeLine,
            boolean includeSdks
    ) {
        // Build inverse rename map: renamed → original. If the caller is
        // searching for "getFoo" but the index has "a" (because user renamed
        // "a" → "getFoo"), look up under "a".
        java.util.Map<String, String> renameMap = renameService.activeRenameMap(projectId);
        String indexedName = name;
        for (var entry : renameMap.entrySet()) {
            if (entry.getValue().equals(name)) {
                indexedName = entry.getKey();
                break;
            }
        }

        List<ProjectUsageRow> rows = usageRepo.findByName(projectId, indexedName, includeSdks, MAX_USAGES);
        if (rows.isEmpty()) return List.of();

        java.util.regex.Pattern qualifier = (qualifyingClass != null && !qualifyingClass.isBlank())
                ? java.util.regex.Pattern.compile(
                    "\\b" + java.util.regex.Pattern.quote(qualifyingClass) +
                    "\\s*\\.\\s*" + java.util.regex.Pattern.quote(name) + "\\b")
                : null;

        List<SymbolUsage> out = new ArrayList<>(rows.size());
        for (ProjectUsageRow r : rows) {
            if (r.file().equals(excludeFile) && r.line() == excludeLine) continue;
            String rewritten = renameMap.isEmpty() ? r.snippet() : rewriteSnippet(r.snippet(), renameMap);
            if (qualifier != null && !qualifier.matcher(rewritten).find()) continue;
            out.add(new SymbolUsage(r.file(), r.line(), rewritten));
        }
        return out;
    }

    /** Apply the active rename map to a snippet for display. Word-boundary
     *  substitution mirrors {@link RenameService#applyMapToContent} so the
     *  rendered usage line matches what the user sees in the file viewer. */
    private static String rewriteSnippet(String snippet, java.util.Map<String, String> renameMap) {
        String s = snippet;
        for (var e : renameMap.entrySet()) {
            String pattern = "\\b" + java.util.regex.Pattern.quote(e.getKey()) + "\\b";
            s = s.replaceAll(pattern, Matcher.quoteReplacement(e.getValue()));
        }
        return s;
    }

    /**
     * VIEWER-OK: symbol-index access. Lazy-cache writes in
     * {@code getOrBuild}/{@code rebuild} are tolerated under viewer access
     * because the cache belongs to the project, not the caller.
     */
    private Project loadProject(User user, UUID projectId) {
        return guard.requireRead(user, projectId);
    }
}
