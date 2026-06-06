package ai.openapk.core.network;

import ai.openapk.core.auth.User;
import ai.openapk.core.network.dto.NetworkHit;
import ai.openapk.core.projects.ProjectAccessGuard;
import ai.openapk.core.projects.storage.ProjectStorage;
import ai.openapk.core.renames.RenameService;
import ai.openapk.core.util.SdkPaths;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.io.IOException;
import java.nio.charset.MalformedInputException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.Iterator;
import java.util.List;
import java.util.UUID;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import java.util.stream.Stream;

/**
 * Static scan for network call sites across the decompiled tree. Coarse —
 * line-based regex, no AST. Surfaces three flavors:
 *
 * <ul>
 *   <li><b>Retrofit</b>: {@code @GET("/path")} and friends — the http method
 *       and path are in the annotation itself, so one line is enough.</li>
 *   <li><b>OkHttp</b>: looks for {@code .url("…")} and pairs it with the
 *       nearest {@code .post(} / {@code .get(} / etc. call within a small
 *       lookahead window.</li>
 *   <li><b>HttpURLConnection</b>: {@code new URL("…")} followed within a
 *       few lines by {@code .openConnection()} or {@code .setRequestMethod(}.</li>
 * </ul>
 *
 * Default: SDK paths filtered (androidx, okhttp3, retrofit2 themselves, …).
 * Toggle {@code includeSdks=true} to keep library-internal sites.
 */
@Service
public class NetworkService {

    private static final Logger log = LoggerFactory.getLogger(NetworkService.class);

    private static final int MAX_FILES = 30_000;
    private static final long MAX_FILE_BYTES = 1024 * 1024;
    private static final int MAX_HITS = 1000;
    private static final int OKHTTP_LOOKAHEAD = 20;

    // Retrofit annotations: @GET("/api/x"), @POST("..."), etc.
    private static final Pattern RETROFIT_ANNOTATION = Pattern.compile(
            "@(GET|POST|PUT|DELETE|PATCH|HEAD|OPTIONS)\\s*\\(\\s*\"([^\"]*)\"\\s*\\)"
    );
    // OkHttp URL setter: .url("https://...")  -or-  .url(someVariable)
    private static final Pattern OKHTTP_URL = Pattern.compile(
            "\\.url\\s*\\(\\s*([^)]+?)\\s*\\)"
    );
    // OkHttp builder method calls: .post(body), .get(), .put(body), etc.
    private static final Pattern OKHTTP_METHOD = Pattern.compile(
            "\\.(get|post|put|delete|patch|head|method)\\s*\\("
    );
    // HttpURLConnection: new URL("...").openConnection() — or split across two lines.
    private static final Pattern NEW_URL = Pattern.compile(
            "new\\s+URL\\s*\\(\\s*([^)]+?)\\s*\\)"
    );
    private static final Pattern SET_REQUEST_METHOD = Pattern.compile(
            "\\.setRequestMethod\\s*\\(\\s*\"([A-Z]+)\"\\s*\\)"
    );

    private final ProjectStorage storage;
    private final RenameService renameService;
    private final ProjectAccessGuard guard;

    public NetworkService(
            ProjectStorage storage,
            RenameService renameService,
            ProjectAccessGuard guard
    ) {
        this.storage = storage;
        this.renameService = renameService;
        this.guard = guard;
    }

    @Transactional(readOnly = true)
    public List<NetworkHit> scan(User user, UUID projectId, boolean includeSdks) {
        // VIEWER-OK: read-only HTTP-call scan over source tree.
        ai.openapk.core.projects.Project project = guard.requireRead(user, projectId);
        Path root = storage.srcDir(project.getUser().getId(), projectId).normalize();
        if (!Files.isDirectory(root)) return List.of();

        List<NetworkHit> hits = new ArrayList<>();
        try (Stream<Path> walk = Files.walk(root)) {
            Iterator<Path> iter = walk.filter(Files::isRegularFile)
                    .filter(p -> p.getFileName().toString().endsWith(".java"))
                    .filter(p -> includeSdks || !SdkPaths.isSdkPath(root.relativize(p).toString()))
                    .limit(MAX_FILES)
                    .iterator();
            while (iter.hasNext() && hits.size() < MAX_HITS) {
                Path p = iter.next();
                String rel = root.relativize(p).toString().replace('\\', '/');
                try {
                    if (Files.size(p) > MAX_FILE_BYTES) continue;
                    String content = Files.readString(p, StandardCharsets.UTF_8);
                    content = renameService.applyMapToContent(projectId, content);
                    String[] lines = content.split("\n", -1);

                    for (int i = 0; i < lines.length && hits.size() < MAX_HITS; i++) {
                        String line = lines[i];
                        scanLineForRetrofit(rel, i, line, hits);
                        scanLineForOkHttp(rel, i, line, lines, hits);
                        scanLineForHttpUrlConnection(rel, i, line, lines, hits);
                    }
                } catch (MalformedInputException e) {
                    // skip
                } catch (IOException e) {
                    log.debug("network scan unreadable {}: {}", p, e.toString());
                }
            }
        } catch (IOException e) {
            log.warn("network walk failed: {}", e.toString());
        }
        return hits;
    }

    private static void scanLineForRetrofit(String rel, int idx, String line, List<NetworkHit> out) {
        Matcher m = RETROFIT_ANNOTATION.matcher(line);
        while (m.find()) {
            out.add(new NetworkHit("retrofit", m.group(1), m.group(2), rel, idx + 1, snippet(line)));
        }
    }

    private static void scanLineForOkHttp(String rel, int idx, String line, String[] allLines, List<NetworkHit> out) {
        Matcher m = OKHTTP_URL.matcher(line);
        if (!m.find()) return;
        String url = stripQuotes(m.group(1).trim());
        String method = "";
        int end = Math.min(idx + OKHTTP_LOOKAHEAD, allLines.length);
        for (int j = idx; j < end; j++) {
            Matcher mm = OKHTTP_METHOD.matcher(allLines[j]);
            if (mm.find()) { method = mm.group(1).toUpperCase(); break; }
        }
        out.add(new NetworkHit("okhttp", method, url, rel, idx + 1, snippet(line)));
    }

    private static void scanLineForHttpUrlConnection(String rel, int idx, String line, String[] allLines, List<NetworkHit> out) {
        Matcher m = NEW_URL.matcher(line);
        if (!m.find()) return;
        // Heuristic: only emit if openConnection appears within a small window — otherwise it's just a URL object.
        boolean looksLikeHttp = line.contains("openConnection") || line.contains("openStream");
        if (!looksLikeHttp) {
            int end = Math.min(idx + 8, allLines.length);
            for (int j = idx + 1; j < end; j++) {
                if (allLines[j].contains("openConnection") || allLines[j].contains("openStream")) {
                    looksLikeHttp = true;
                    break;
                }
            }
        }
        if (!looksLikeHttp) return;

        String url = stripQuotes(m.group(1).trim());
        String method = "";
        int end = Math.min(idx + 12, allLines.length);
        for (int j = idx; j < end; j++) {
            Matcher mm = SET_REQUEST_METHOD.matcher(allLines[j]);
            if (mm.find()) { method = mm.group(1); break; }
        }
        out.add(new NetworkHit("httpurlconnection", method, url, rel, idx + 1, snippet(line)));
    }

    private static String stripQuotes(String s) {
        if (s.length() >= 2 && s.startsWith("\"") && s.endsWith("\"")) {
            return s.substring(1, s.length() - 1);
        }
        return s;
    }

    private static String snippet(String line) {
        String s = line.length() > 240 ? line.substring(0, 240) + "…" : line;
        return s.stripLeading();
    }
}
