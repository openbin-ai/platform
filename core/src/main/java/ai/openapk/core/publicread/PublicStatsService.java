package ai.openapk.core.publicread;

import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;

import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.util.concurrent.atomic.AtomicReference;

/**
 * Platform-wide headline numbers for the marketing landings (openbin.ai,
 * openapk.ai). Three counts, nothing per-user, nothing that names a
 * project: the point is "this place is alive", not analytics.
 *
 * <p>"Online" means an authenticated API call in the last five minutes —
 * {@code users.last_seen_at} is bumped on every authed request by
 * {@code CurrentUserService}, so the web apps, the CLI and BINNY Desktop
 * all count. Someone idling in a tab with no requests does not, so the
 * number reads conservative.
 *
 * <p>Cached for one minute in-process. Two landings polling this on every
 * visit is the one anonymous endpoint that could otherwise turn into a
 * steady trickle of {@code count(*)} on the users table. One stale minute
 * is invisible on a page that only shows the number once.
 */
@Service
public class PublicStatsService {

    public record Stats(long users, long online, long publicReports, Instant computedAt) {}

    static final Duration TTL = Duration.ofMinutes(1);
    static final Duration ONLINE_WINDOW = Duration.ofMinutes(5);

    private final JdbcTemplate jdbc;
    private final Clock clock;
    private final AtomicReference<Stats> cache = new AtomicReference<>();

    // Two constructors, so Spring needs to be told which one is the bean's.
    // Without this annotation it looks for a no-arg constructor, finds none,
    // and the whole context fails to start (took the 2026-11-08 rollout down).
    @Autowired
    public PublicStatsService(JdbcTemplate jdbc) {
        this(jdbc, Clock.systemUTC());
    }

    /** Test seam: a fixed clock for the cache-TTL and online-window assertions. */
    PublicStatsService(JdbcTemplate jdbc, Clock clock) {
        this.jdbc = jdbc;
        this.clock = clock;
    }

    public Stats current() {
        Instant now = clock.instant();
        Stats cached = cache.get();
        if (cached != null && cached.computedAt().plus(TTL).isAfter(now)) return cached;
        // Racing refreshes both run the same three cheap queries and the
        // last writer wins; no lock needed for a once-a-minute recompute.
        Stats fresh = compute(now);
        cache.set(fresh);
        return fresh;
    }

    private Stats compute(Instant now) {
        long users = count("SELECT count(*) FROM users");
        long online = jdbc.queryForObject(
                "SELECT count(*) FROM users WHERE last_seen_at >= ?",
                Long.class,
                java.sql.Timestamp.from(now.minus(ONLINE_WINDOW)));
        long reports = count(
                "SELECT count(*) FROM project_reports WHERE community_published_at IS NOT NULL");
        return new Stats(users, online, reports, now);
    }

    private long count(String sql) {
        Long v = jdbc.queryForObject(sql, Long.class);
        return v == null ? 0 : v;
    }
}
