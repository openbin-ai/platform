package ai.openapk.core.social;

import ai.openapk.core.auth.User;
import ai.openapk.core.auth.UserRepository;
import ai.openapk.core.notifications.NotificationService;
import ai.openapk.core.projects.ProjectKind;
import ai.openapk.core.reports.CommunityService;
import ai.openapk.core.reports.ProjectReport;
import ai.openapk.core.reports.ProjectReportRepository;
import ai.openapk.core.reports.ReportContributorService;
import ai.openapk.core.reports.dto.CommunityReportSummary;
import ai.openapk.core.reports.dto.Contributor;
import ai.openapk.core.social.dto.ProfileResponse;
import ai.openapk.core.social.dto.SocialUserSummary;
import ai.openapk.core.social.dto.ToggleResponse;
import jakarta.persistence.EntityManager;
import jakarta.persistence.PersistenceContext;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.server.ResponseStatusException;

import java.sql.Timestamp;
import java.time.Instant;
import java.time.OffsetDateTime;
import java.time.ZonedDateTime;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.UUID;

/**
 * Authenticated social-layer service: follows, upvotes, personal feed,
 * public profile read. Companion to {@link CommunityService} (which
 * owns anonymous read paths).
 *
 * <p>Personal feed lives here rather than on CommunityService because it
 * fundamentally requires the viewer's identity to drive the followee
 * join — the anonymous feed never needs that path.
 */
@Service
public class SocialService {

    private static final int MAX_PAGE_SIZE = 50;

    @PersistenceContext
    private EntityManager em;

    private final FollowRepository followRepo;
    private final ReportVoteRepository voteRepo;
    private final UserRepository userRepo;
    private final ProjectReportRepository reportRepo;
    private final CommunityService communityService;
    private final NotificationService notifications;
    private final ReportContributorService contributors;

    public SocialService(FollowRepository followRepo, ReportVoteRepository voteRepo,
                         UserRepository userRepo, ProjectReportRepository reportRepo,
                         CommunityService communityService,
                         NotificationService notifications,
                         ReportContributorService contributors) {
        this.followRepo = followRepo;
        this.voteRepo = voteRepo;
        this.userRepo = userRepo;
        this.reportRepo = reportRepo;
        this.communityService = communityService;
        this.notifications = notifications;
        this.contributors = contributors;
    }

    // ─── follows ────────────────────────────────────────────────────────

    /**
     * Idempotent follow. Repeat POSTs from a flaky client land on the
     * composite PK and become no-ops via {@code ON CONFLICT DO NOTHING}.
     * Returns the new follower count so the caller can update the badge
     * without a second request.
     */
    @Transactional
    public ToggleResponse follow(User follower, UUID followeeId) {
        if (follower.getId().equals(followeeId)) {
            // Same protection as the DB CHECK; surfacing 400 here gives a
            // clearer error than the generic constraint-violation 500.
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "cannot follow yourself");
        }
        User followee = userRepo.findById(followeeId).orElseThrow(() ->
                new ResponseStatusException(HttpStatus.NOT_FOUND, "user not found"));

        int inserted = em.createNativeQuery("""
                INSERT INTO follows (follower_id, followee_id, created_at)
                VALUES (:follower, :followee, NOW())
                ON CONFLICT (follower_id, followee_id) DO NOTHING
                """)
                .setParameter("follower", follower.getId())
                .setParameter("followee", followeeId)
                .executeUpdate();

        // Only notify on a fresh follow — repeat POSTs from a flaky client
        // (or a double-tap) shouldn't spam the followee's inbox. The
        // ON CONFLICT path returns 0 affected rows; the new-row path
        // returns 1.
        if (inserted > 0) {
            notifications.notifyNewFollower(followee, follower);
        }

        return new ToggleResponse(true, followRepo.countByFolloweeId(followeeId));
    }

    @Transactional
    public ToggleResponse unfollow(User follower, UUID followeeId) {
        em.createNativeQuery("""
                DELETE FROM follows
                WHERE follower_id = :follower AND followee_id = :followee
                """)
                .setParameter("follower", follower.getId())
                .setParameter("followee", followeeId)
                .executeUpdate();

        return new ToggleResponse(false, followRepo.countByFolloweeId(followeeId));
    }

    // ─── votes ──────────────────────────────────────────────────────────

    @Transactional
    public ToggleResponse upvote(User user, UUID reportId) {
        ProjectReport report = reportRepo.findById(reportId).orElseThrow(() ->
                new ResponseStatusException(HttpStatus.NOT_FOUND, "report not found"));
        // Upvotes are only meaningful on community-visible reports — gate
        // here so abuse can't seed votes on private/unpublished work.
        if (report.getCommunityPublishedAt() == null) {
            throw new ResponseStatusException(HttpStatus.NOT_FOUND, "report not found");
        }

        em.createNativeQuery("""
                INSERT INTO report_votes (user_id, report_id, created_at)
                VALUES (:user, :report, NOW())
                ON CONFLICT (user_id, report_id) DO NOTHING
                """)
                .setParameter("user", user.getId())
                .setParameter("report", reportId)
                .executeUpdate();

        return new ToggleResponse(true, voteRepo.countByReportId(reportId));
    }

    @Transactional
    public ToggleResponse unvote(User user, UUID reportId) {
        em.createNativeQuery("""
                DELETE FROM report_votes
                WHERE user_id = :user AND report_id = :report
                """)
                .setParameter("user", user.getId())
                .setParameter("report", reportId)
                .executeUpdate();

        return new ToggleResponse(false, voteRepo.countByReportId(reportId));
    }

    // ─── personal feed ──────────────────────────────────────────────────

    /**
     * Reports published by people the caller follows. Empty result is the
     * "you follow nobody yet" state — the frontend prompts the user to
     * browse the global feed when this is empty so the dashboard never
     * looks dead. Hard-filtered to one project kind so the openapk-frontend
     * call doesn't surface BIN reports (and vice versa).
     */
    @Transactional(readOnly = true)
    public List<CommunityReportSummary> personalFeed(User viewer, ProjectKind kind, int page, int size) {
        int limit = Math.min(Math.max(1, size), MAX_PAGE_SIZE);
        int offset = Math.max(0, page) * limit;

        var nq = em.createNativeQuery("""
                SELECT r.id, r.project_id, r.title, r.malware_type, r.tags, r.sections_jsonb,
                       r.community_published_at,
                       p.name AS project_name, p.sha256,
                       u.id AS author_id, u.display_name, u.email,
                       (SELECT COUNT(*) FROM report_votes v WHERE v.report_id = r.id) AS vote_count,
                       EXISTS (SELECT 1 FROM report_votes v2
                               WHERE v2.report_id = r.id AND v2.user_id = :viewer) AS voted_by_me
                FROM project_reports r
                JOIN projects p ON r.project_id = p.id
                JOIN users u ON p.user_id = u.id
                JOIN follows f ON f.followee_id = u.id
                WHERE r.community_published_at IS NOT NULL
                  AND p.kind = ANY(CAST(:kinds AS text[]))
                  AND f.follower_id = :viewer
                ORDER BY r.community_published_at DESC
                LIMIT :limit OFFSET :offset
                """);
        nq.setParameter("viewer", viewer.getId());
        nq.setParameter("kinds", kind.surfaceKindsPgArray());
        nq.setParameter("limit", limit);
        nq.setParameter("offset", offset);

        @SuppressWarnings("unchecked")
        List<Object[]> rows = nq.getResultList();
        return mapRows(rows);
    }

    // ─── follower / following lists ─────────────────────────────────────

    /**
     * People following this user, newest follow first. Paginated; anonymous
     * read is supported (the per-row {@code amFollowing} flag is always
     * false when {@code viewerOrNull} is null). Used to render the
     * "followers" sub-page off the public profile.
     */
    @Transactional(readOnly = true)
    public List<SocialUserSummary> followersOf(UUID userId, User viewerOrNull, int page, int size) {
        return listUsers(userId, viewerOrNull, page, size, /*direction=*/"followers");
    }

    /**
     * People this user follows, newest follow first. Same contract as
     * {@link #followersOf} but joins in the other direction.
     */
    @Transactional(readOnly = true)
    public List<SocialUserSummary> followingOf(UUID userId, User viewerOrNull, int page, int size) {
        return listUsers(userId, viewerOrNull, page, size, /*direction=*/"following");
    }

    /**
     * Backs both list endpoints. The {@code direction} switch is
     * whitelisted at this call site so the user-controlled path segment
     * never reaches the SQL — the join clause is constant per branch.
     */
    private List<SocialUserSummary> listUsers(UUID userId, User viewerOrNull, int page, int size, String direction) {
        // Existence check up front so anon callers get a clean 404 instead
        // of an empty list (which would leak "user doesn't exist" by
        // omission anyway).
        userRepo.findById(userId).orElseThrow(() ->
                new ResponseStatusException(HttpStatus.NOT_FOUND, "user not found"));

        int limit = Math.min(Math.max(1, size), MAX_PAGE_SIZE);
        int offset = Math.max(0, page) * limit;

        // followers-of(X): join users on f.follower_id = u.id where f.followee_id = X
        // following-of(X): join users on f.followee_id = u.id where f.follower_id = X
        String join;
        String filterCol;
        if ("followers".equals(direction)) {
            join = "JOIN users u ON u.id = f.follower_id";
            filterCol = "f.followee_id";
        } else {
            join = "JOIN users u ON u.id = f.followee_id";
            filterCol = "f.follower_id";
        }

        UUID viewerId = viewerOrNull == null ? null : viewerOrNull.getId();

        // Plain concatenation rather than a text block — Java text blocks
        // strip trailing whitespace from content lines, so a literal
        // `"""WHERE """ + filterCol` produced `WHEREf.followee_id` (no
        // space). The followers / following endpoints were broken under
        // load until this rewrite.
        String sql =
                "SELECT u.id, u.display_name, u.email, f.created_at, " +
                "       (:viewerKnown AND EXISTS (" +
                "           SELECT 1 FROM follows me " +
                "           WHERE me.follower_id = :viewer AND me.followee_id = u.id" +
                "       )) AS am_following " +
                "FROM follows f " +
                join + " " +
                "WHERE " + filterCol + " = :anchor " +
                "ORDER BY f.created_at DESC " +
                "LIMIT :limit OFFSET :offset";
        var nq = em.createNativeQuery(sql);
        nq.setParameter("anchor", userId);
        nq.setParameter("limit", limit);
        nq.setParameter("offset", offset);
        nq.setParameter("viewerKnown", viewerId != null);
        nq.setParameter("viewer", viewerId != null ? viewerId : new UUID(0L, 0L));

        @SuppressWarnings("unchecked")
        List<Object[]> rows = nq.getResultList();
        var out = new ArrayList<SocialUserSummary>(rows.size());
        for (Object[] r : rows) {
            UUID uid = (UUID) r[0];
            String displayName = (String) r[1];
            String email = (String) r[2];
            Instant followedAt = toInstant(r[3]);
            boolean amFollowing = (Boolean) r[4];
            out.add(new SocialUserSummary(
                    uid,
                    displayNameOrFallback(displayName, email),
                    CommunityService.md5Hex(email),
                    followedAt,
                    amFollowing
            ));
        }
        return out;
    }

    // ─── profile ────────────────────────────────────────────────────────

    /**
     * Public author profile: display name, gravatar hash, follower/following
     * counts, and that user's community-published reports (newest first).
     * Anonymous-readable — gated on the report visibility, not the viewer.
     */
    @Transactional(readOnly = true)
    public ProfileResponse profile(UUID userId, User viewerOrNull, ProjectKind kind) {
        User u = userRepo.findById(userId).orElseThrow(() ->
                new ResponseStatusException(HttpStatus.NOT_FOUND, "user not found"));

        var nq = em.createNativeQuery("""
                SELECT r.id, r.project_id, r.title, r.malware_type, r.tags, r.sections_jsonb,
                       r.community_published_at,
                       p.name AS project_name, p.sha256,
                       u.id AS author_id, u.display_name, u.email,
                       (SELECT COUNT(*) FROM report_votes v WHERE v.report_id = r.id) AS vote_count,
                       :viewerKnown AND EXISTS (SELECT 1 FROM report_votes v2
                               WHERE v2.report_id = r.id AND v2.user_id = :viewer) AS voted_by_me
                FROM project_reports r
                JOIN projects p ON r.project_id = p.id
                JOIN users u ON p.user_id = u.id
                WHERE r.community_published_at IS NOT NULL
                  AND p.kind = ANY(CAST(:kinds AS text[]))
                  AND p.user_id = :author
                ORDER BY r.community_published_at DESC
                LIMIT 50
                """);
        nq.setParameter("author", u.getId());
        nq.setParameter("kinds", kind.surfaceKindsPgArray());
        nq.setParameter("viewerKnown", viewerOrNull != null);
        // Postgres still binds the param even on the short-circuit branch,
        // so pass the author UUID as a stand-in when anonymous (NULL would
        // need a separate query shape).
        nq.setParameter("viewer", viewerOrNull != null ? viewerOrNull.getId() : u.getId());

        @SuppressWarnings("unchecked")
        List<Object[]> rows = nq.getResultList();
        var reports = mapRows(rows);

        // Collaborative reports: published reports where this user is a
        // credited CONTRIBUTOR (not the lead/owner). Driven by the byline
        // snapshot, so only reports (re)published after bylines existed appear.
        var collabQuery = em.createNativeQuery("""
                SELECT r.id, r.project_id, r.title, r.malware_type, r.tags, r.sections_jsonb,
                       r.community_published_at,
                       p.name AS project_name, p.sha256,
                       u.id AS author_id, u.display_name, u.email,
                       (SELECT COUNT(*) FROM report_votes v WHERE v.report_id = r.id) AS vote_count,
                       :viewerKnown AND EXISTS (SELECT 1 FROM report_votes v2
                               WHERE v2.report_id = r.id AND v2.user_id = :viewer) AS voted_by_me
                FROM report_contributors rc
                JOIN project_reports r ON rc.report_id = r.id
                JOIN projects p ON r.project_id = p.id
                JOIN users u ON p.user_id = u.id
                WHERE rc.user_id = :author
                  AND rc.credit = 'CONTRIBUTOR'
                  AND r.community_published_at IS NOT NULL
                  AND p.kind = ANY(CAST(:kinds AS text[]))
                ORDER BY r.community_published_at DESC
                LIMIT 50
                """);
        collabQuery.setParameter("author", u.getId());
        collabQuery.setParameter("kinds", kind.surfaceKindsPgArray());
        collabQuery.setParameter("viewerKnown", viewerOrNull != null);
        collabQuery.setParameter("viewer", viewerOrNull != null ? viewerOrNull.getId() : u.getId());
        @SuppressWarnings("unchecked")
        List<Object[]> collabRows = collabQuery.getResultList();
        var collaborativeReports = mapRows(collabRows);

        boolean amFollowing = viewerOrNull != null && !viewerOrNull.getId().equals(u.getId())
                && followRepo.existsByFollowerIdAndFolloweeId(viewerOrNull.getId(), u.getId());

        return new ProfileResponse(
                u.getId(),
                displayNameOrFallback(u.getDisplayName(), u.getEmail()),
                CommunityService.md5Hex(u.getEmail()),
                u.getCreatedAt(),
                followRepo.countByFolloweeId(u.getId()),
                followRepo.countByFollowerId(u.getId()),
                amFollowing,
                reports,
                collaborativeReports
        );
    }

    // ─── helpers ────────────────────────────────────────────────────────

    private CommunityReportSummary mapRow(Object[] r, Map<UUID, List<Contributor>> contribByReport) {
        UUID reportId = (UUID) r[0];
        UUID projectId = (UUID) r[1];
        String title = (String) r[2];
        String mt = (String) r[3];
        List<String> rowTags = pgArrayToList(r[4]);
        String sectionsJson = (String) r[5];
        Instant published = toInstant(r[6]);
        String projectName = (String) r[7];
        String sha = (String) r[8];
        UUID authorId = (UUID) r[9];
        String displayName = (String) r[10];
        String emailAddr = (String) r[11];
        long voteCount = ((Number) r[12]).longValue();
        boolean votedByMe = (Boolean) r[13];

        return new CommunityReportSummary(
                reportId, projectId, title, projectName, mt, rowTags, sha,
                published,
                authorId,
                displayNameOrFallback(displayName, emailAddr),
                CommunityService.md5Hex(emailAddr),
                communityService.previewFromSections(sectionsJson),
                voteCount,
                votedByMe,
                contribByReport.getOrDefault(reportId, List.of())
        );
    }

    /** Batch the byline lookup for a result set, then map each row. */
    private List<CommunityReportSummary> mapRows(List<Object[]> rows) {
        var reportIds = rows.stream().map(r -> (UUID) r[0]).toList();
        var contribByReport = contributors.forReports(reportIds);
        var out = new ArrayList<CommunityReportSummary>(rows.size());
        for (Object[] r : rows) out.add(mapRow(r, contribByReport));
        return out;
    }

    private static Instant toInstant(Object raw) {
        if (raw == null) return null;
        if (raw instanceof Instant i) return i;
        if (raw instanceof Timestamp ts) return ts.toInstant();
        if (raw instanceof OffsetDateTime odt) return odt.toInstant();
        if (raw instanceof ZonedDateTime zdt) return zdt.toInstant();
        throw new IllegalStateException("unexpected timestamp type from JDBC: " + raw.getClass().getName());
    }

    private static List<String> pgArrayToList(Object raw) {
        if (raw == null) return List.of();
        if (raw instanceof java.sql.Array a) {
            try {
                Object inner = a.getArray();
                if (inner instanceof String[] arr) return List.of(arr);
            } catch (Exception ignored) {}
        }
        if (raw instanceof String[] arr) return List.of(arr);
        if (raw instanceof List<?> l) {
            var out = new ArrayList<String>(l.size());
            for (Object o : l) if (o != null) out.add(o.toString());
            return out;
        }
        String s = raw.toString();
        if (s.length() < 2 || s.charAt(0) != '{' || s.charAt(s.length() - 1) != '}') return List.of();
        String body = s.substring(1, s.length() - 1);
        if (body.isEmpty()) return List.of();
        var parts = body.split(",");
        var out = new ArrayList<String>(parts.length);
        var seen = new HashSet<String>();
        for (String p : parts) {
            String t = p.trim();
            if (t.startsWith("\"") && t.endsWith("\"")) t = t.substring(1, t.length() - 1);
            if (!t.isEmpty() && seen.add(t)) out.add(t);
        }
        return out;
    }

    private static String displayNameOrFallback(String displayName, String emailAddr) {
        if (displayName != null && !displayName.isBlank()) return displayName;
        if (emailAddr != null && emailAddr.contains("@")) {
            return emailAddr.substring(0, emailAddr.indexOf('@'));
        }
        return "anonymous researcher";
    }

    // ─── search ─────────────────────────────────────────────────────────

    /**
     * Case-insensitive substring search over researcher display names + the
     * username half of their email (the fallback name shown when display_name
     * is blank). Covers ALL registered users, not just publishers — the
     * original publisher-only restriction made everyone who hadn't published
     * yet unfindable, which broke the follow flow (you couldn't follow a
     * colleague before their first report). Publishers still rank above
     * non-publishers at equal match quality. Exposes only what a profile
     * page already shows (display name + gravatar hash), never the email.
     *
     * <p>{@code amFollowing} mirrors the followers-list shape: opportunistic
     * personalization when the viewer is authenticated, false for anonymous.
     * Returns at most {@link #MAX_PAGE_SIZE} rows per page.
     */
    @Transactional(readOnly = true)
    public List<SocialUserSummary> searchUsers(String q, User viewerOrNull, int page, int size) {
        String trimmed = q == null ? "" : q.trim();
        if (trimmed.length() < 2) {
            // Avoid an effectively-unbounded scan; the UI already
            // debounces the input and disables submit below 2 chars.
            return List.of();
        }
        int limit = Math.min(Math.max(1, size), MAX_PAGE_SIZE);
        int offset = Math.max(0, page) * limit;
        UUID viewerId = viewerOrNull == null ? null : viewerOrNull.getId();

        // The match expression is shared between the WHERE and the ORDER BY
        // so a name that starts with the query ranks above a name that
        // merely contains it. `SIMILAR TO`-style ranking would be nicer but
        // pulls in extensions; this is good enough for the dataset size.
        var nq = em.createNativeQuery("""
                SELECT u.id, u.display_name, u.email,
                       COALESCE(MIN(r.community_published_at), u.created_at) AS joined_at,
                       (:viewerKnown AND EXISTS (
                           SELECT 1 FROM follows me
                           WHERE me.follower_id = :viewer AND me.followee_id = u.id
                       )) AS am_following,
                       CASE
                           WHEN LOWER(COALESCE(u.display_name, '')) LIKE :prefix THEN 0
                           WHEN LOWER(SPLIT_PART(u.email, '@', 1)) LIKE :prefix THEN 1
                           ELSE 2
                       END AS rank,
                       (MIN(r.community_published_at) IS NULL) AS unpublished
                FROM users u
                LEFT JOIN projects p ON p.user_id = u.id
                LEFT JOIN project_reports r ON r.project_id = p.id
                       AND r.community_published_at IS NOT NULL
                WHERE (
                       LOWER(COALESCE(u.display_name, '')) LIKE :needle
                    OR LOWER(SPLIT_PART(u.email, '@', 1)) LIKE :needle
                  )
                GROUP BY u.id, u.display_name, u.email, u.created_at
                ORDER BY rank, unpublished, joined_at DESC
                LIMIT :limit OFFSET :offset
                """);
        String lower = trimmed.toLowerCase(java.util.Locale.ROOT);
        nq.setParameter("needle", "%" + lower + "%");
        nq.setParameter("prefix", lower + "%");
        nq.setParameter("limit", limit);
        nq.setParameter("offset", offset);
        nq.setParameter("viewerKnown", viewerId != null);
        nq.setParameter("viewer", viewerId != null ? viewerId : new UUID(0L, 0L));

        @SuppressWarnings("unchecked")
        List<Object[]> rows = nq.getResultList();
        var out = new ArrayList<SocialUserSummary>(rows.size());
        for (Object[] r : rows) {
            UUID uid = (UUID) r[0];
            String displayName = (String) r[1];
            String email = (String) r[2];
            Instant joinedAt = toInstant(r[3]);
            boolean amFollowing = (Boolean) r[4];
            out.add(new SocialUserSummary(
                    uid,
                    displayNameOrFallback(displayName, email),
                    CommunityService.md5Hex(email),
                    joinedAt,
                    amFollowing
            ));
        }
        return out;
    }
}
