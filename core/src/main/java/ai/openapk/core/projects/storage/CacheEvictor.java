package ai.openapk.core.projects.storage;

import ai.openapk.core.config.OpenApkProperties;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.attribute.BasicFileAttributes;
import java.time.Instant;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;
import java.util.stream.Stream;

/**
 * LRU cache evictor for the S3-backed storage's local cache. Only active when
 * {@code openapk.storage.backend=s3} — the fs backend never deletes data
 * because the cache IS the source of truth.
 *
 * <p>Runs every 5 minutes. Computes free space on the cache root; if it's
 * below {@code openapk.storage.cache-min-free-percent}, walks every cached
 * project's {@code .last-accessed} sentinel, sorts oldest-first, and deletes
 * project dirs until free space exceeds the threshold by 5 percentage points
 * (hysteresis — keeps us from oscillating delete/re-fetch on every tick).
 *
 * <p>Evicted projects re-materialize from S3 on next access. The user-visible
 * effect is a one-time multi-second pause as the tar.gz is downloaded and
 * extracted. That's acceptable for cold projects; the evictor never touches
 * recently-accessed ones.
 */
@Component
@ConditionalOnProperty(name = "openapk.storage.backend", havingValue = "s3")
public class CacheEvictor {

    private static final Logger log = LoggerFactory.getLogger(CacheEvictor.class);

    private final Path cacheRoot;
    private final int minFreePercent;

    public CacheEvictor(OpenApkProperties props) {
        this.cacheRoot = Path.of(props.workspace().dir()).toAbsolutePath().normalize();
        Integer pct = props.storage() != null ? props.storage().cacheMinFreePercent() : null;
        this.minFreePercent = pct != null ? pct : 20;
        log.info("CacheEvictor armed: root={} minFree={}%", cacheRoot, minFreePercent);
    }

    @Scheduled(fixedDelay = 5 * 60_000L, initialDelay = 60_000L)
    public void sweep() {
        try {
            sweepOnce();
        } catch (Exception e) {
            // Never let a sweep failure kill the scheduler thread.
            log.warn("cache sweep failed: {}", e.toString());
        }
    }

    void sweepOnce() throws IOException {
        if (!Files.exists(cacheRoot)) return;

        long total = cacheRoot.toFile().getTotalSpace();
        long free = cacheRoot.toFile().getUsableSpace();
        if (total == 0) return;
        double freePct = 100.0 * free / total;
        if (freePct >= minFreePercent) {
            log.debug("cache sweep: free={}% threshold={}% — nothing to do",
                    String.format("%.1f", freePct), minFreePercent);
            return;
        }

        log.info("cache sweep: free={}% < threshold={}% — evicting",
                String.format("%.1f", freePct), minFreePercent);

        var candidates = collectProjects();
        // Sort by last-accessed mtime ascending — oldest first.
        candidates.sort(Comparator.comparing(CachedProject::lastAccessed));

        // Evict until we cross the hysteresis target (threshold + 5).
        double target = minFreePercent + 5.0;
        int evicted = 0;
        for (CachedProject c : candidates) {
            long freeNow = cacheRoot.toFile().getUsableSpace();
            double freePctNow = 100.0 * freeNow / total;
            if (freePctNow >= target) break;
            log.info("evicting cached project {} (lastAccessed={})", c.dir, c.lastAccessed);
            deleteRecursive(c.dir);
            evicted++;
        }
        log.info("cache sweep done: evicted={} freeAfter={}%",
                evicted, String.format("%.1f", 100.0 * cacheRoot.toFile().getUsableSpace() / total));
    }

    private List<CachedProject> collectProjects() throws IOException {
        Path usersRoot = cacheRoot.resolve("users");
        if (!Files.exists(usersRoot)) return List.of();
        var out = new ArrayList<CachedProject>();
        try (Stream<Path> userDirs = Files.list(usersRoot)) {
            userDirs.filter(Files::isDirectory).forEach(userDir -> {
                Path projects = userDir.resolve("projects");
                if (!Files.isDirectory(projects)) return;
                try (Stream<Path> projDirs = Files.list(projects)) {
                    projDirs.filter(Files::isDirectory).forEach(projDir -> {
                        Path marker = projDir.resolve(S3ProjectStorage.LAST_ACCESSED_MARKER);
                        Instant ts = readMarkerOrFallback(projDir, marker);
                        out.add(new CachedProject(projDir, ts));
                    });
                } catch (IOException e) {
                    log.warn("could not enumerate projects under {}: {}", projects, e.toString());
                }
            });
        }
        return out;
    }

    private static Instant readMarkerOrFallback(Path projDir, Path marker) {
        try {
            if (Files.exists(marker)) {
                return Files.getLastModifiedTime(marker).toInstant();
            }
            // No marker — fall back to the directory's own mtime so a never-
            // touched project still has a reasonable LRU position.
            return Files.readAttributes(projDir, BasicFileAttributes.class)
                    .lastModifiedTime().toInstant();
        } catch (IOException e) {
            return Instant.EPOCH;
        }
    }

    private static void deleteRecursive(Path dir) {
        try (Stream<Path> walk = Files.walk(dir)) {
            walk.sorted(Comparator.reverseOrder()).forEach(p -> {
                try {
                    Files.deleteIfExists(p);
                } catch (IOException e) {
                    log.warn("evict delete failed for {}: {}", p, e.toString());
                }
            });
        } catch (IOException e) {
            log.warn("evict walk failed for {}: {}", dir, e.toString());
        }
    }

    private record CachedProject(Path dir, Instant lastAccessed) {}
}
