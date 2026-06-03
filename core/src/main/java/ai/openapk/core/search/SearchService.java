package ai.openapk.core.search;

import ai.openapk.core.auth.User;
import ai.openapk.core.projects.ProjectRepository;
import ai.openapk.core.projects.storage.ProjectStorage;
import ai.openapk.core.search.dto.SearchHit;
import ai.openapk.core.util.SdkPaths;
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
import java.util.ArrayList;
import java.util.Iterator;
import java.util.List;
import java.util.Set;
import java.util.UUID;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import java.util.regex.PatternSyntaxException;
import java.util.stream.Stream;

/**
 * Project-wide grep over the decompiled tree. Walks every text file under the
 * project's srcDir, matches a substring or regex per line, and returns up to
 * {@code limit} hits as (file, line, snippet) tuples.
 *
 * Default behavior filters out bundled SDK paths (androidx, kotlin, okhttp, …)
 * because the noise dwarfs real signal. The {@code includeSdks} flag turns
 * that off when the researcher actually wants library code in the results.
 */
@Service
public class SearchService {

    private static final Logger log = LoggerFactory.getLogger(SearchService.class);

    private static final int DEFAULT_LIMIT = 200;
    private static final int MAX_LIMIT = 1000;
    private static final long MAX_FILE_BYTES = 1024 * 1024;
    private static final int MAX_FILES = 20_000;
    private static final int SNIPPET_MAX = 240;

    private static final Set<String> TEXT_EXTS = Set.of(
            "java", "kt", "smali",
            "xml", "json", "properties",
            "yml", "yaml", "txt", "md",
            "cfg", "ini", "html", "js", "ts"
    );

    private final ProjectRepository projectRepo;
    private final ProjectStorage storage;

    public SearchService(ProjectRepository projectRepo, ProjectStorage storage) {
        this.projectRepo = projectRepo;
        this.storage = storage;
    }

    @Transactional(readOnly = true)
    public List<SearchHit> search(
            User user, UUID projectId,
            String q, boolean caseSensitive, boolean regex, boolean includeSdks, int limit
    ) {
        if (q == null || q.isBlank()) return List.of();
        projectRepo.findByIdAndUserId(projectId, user.getId())
                .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND, "project not found"));

        Path root = storage.srcDir(user.getId(), projectId).normalize();
        if (!Files.isDirectory(root)) return List.of();

        Pattern pattern;
        try {
            int flags = caseSensitive ? 0 : (Pattern.CASE_INSENSITIVE | Pattern.UNICODE_CASE);
            pattern = regex ? Pattern.compile(q, flags) : Pattern.compile(Pattern.quote(q), flags);
        } catch (PatternSyntaxException e) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "invalid regex: " + e.getDescription());
        }

        int cap = Math.max(1, Math.min(limit <= 0 ? DEFAULT_LIMIT : limit, MAX_LIMIT));
        List<SearchHit> hits = new ArrayList<>();

        try (Stream<Path> walk = Files.walk(root)) {
            Iterator<Path> iter = walk.filter(Files::isRegularFile)
                    .filter(p -> isTextFile(p.getFileName().toString()))
                    .filter(p -> includeSdks || !SdkPaths.isSdkPath(root.relativize(p).toString()))
                    .limit(MAX_FILES)
                    .iterator();
            while (iter.hasNext() && hits.size() < cap) {
                Path p = iter.next();
                try {
                    if (Files.size(p) > MAX_FILE_BYTES) continue;
                    List<String> lines = Files.readAllLines(p, StandardCharsets.UTF_8);
                    String rel = root.relativize(p).toString().replace('\\', '/');
                    for (int i = 0; i < lines.size() && hits.size() < cap; i++) {
                        String line = lines.get(i);
                        Matcher m = pattern.matcher(line);
                        if (m.find()) {
                            hits.add(new SearchHit(rel, i + 1, snippet(line)));
                        }
                    }
                } catch (MalformedInputException e) {
                    // not UTF-8 — skip binary or wrong-encoding files quietly
                } catch (IOException e) {
                    log.debug("search: unreadable {}: {}", p, e.toString());
                }
            }
        } catch (IOException e) {
            log.warn("search walk failed: {}", e.toString());
        }
        return hits;
    }

    private static boolean isTextFile(String name) {
        int dot = name.lastIndexOf('.');
        if (dot < 0 || dot == name.length() - 1) return false;
        return TEXT_EXTS.contains(name.substring(dot + 1).toLowerCase());
    }

    private static String snippet(String line) {
        String s = line.length() > SNIPPET_MAX ? line.substring(0, SNIPPET_MAX) + "…" : line;
        // Collapse leading whitespace — the column position is unimportant in the
        // results panel and a deeply indented match wastes horizontal space.
        return s.stripLeading();
    }
}
