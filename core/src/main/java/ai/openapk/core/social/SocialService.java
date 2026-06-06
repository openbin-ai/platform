package ai.openapk.core.social;

import ai.openapk.core.auth.User;
import ai.openapk.core.auth.UserRepository;
import ai.openapk.core.projects.ProjectKind;
import ai.openapk.core.reports.CommunityService;
import ai.openapk.core.reports.ProjectReport;
import ai.openapk.core.reports.ProjectReportRepository;
import ai.openapk.core.reports.dto.CommunityReportSummary;
import ai.openapk.core.social.dto.ProfileResponse;
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

    public SocialService(FollowRepository followRepo, ReportVoteRepository voteRepo,
                         UserRepository userRepo, ProjectReportRepository reportRepo,
                         CommunityService communityService) {
        this.followRepo = followRepo;
        this.voteRepo = voteRepo;
        this.userRepo = userRepo;
        this.reportRepo = reportRepo;
        this.communityService = communityService;
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
        userRepo.findById(followeeId).orElseThrow(() ->
                new ResponseStatusException(HttpStatus.NOT_FOUND, "user not found"));

        em.createNativeQuery("""
                INSERT INTO follows (follower_id, followee_id, created_at)
                VALUES (:follower, :followee, NOW())
                ON CONFLICT (follower_id, followee_id) DO NOTHING
                """)
                .setParameter("follower", follower.getId())
                .setParameter("followee", followeeId)
                .executeUpdate();

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
                  AND p.kind = :kind
                  AND f.follower_id = :viewer
                ORDER BY r.community_published_at DESC
                LIMIT :limit OFFSET :offset
                """);
        nq.setParameter("viewer", viewer.getId());
        nq.setParameter("kind", kind.name());
        nq.setParameter("limit", limit);
        nq.setParameter("offset", offset);

        @SuppressWarnings("unchecked")
        List<Object[]> rows = nq.getResultList();
        var out = new ArrayList<CommunityReportSummary>(rows.size());
        for (Object[] r : rows) {
            out.add(mapRow(r));
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
                  AND p.kind = :kind
                  AND p.user_id = :author
                ORDER BY r.community_published_at DESC
                LIMIT 50
                """);
        nq.setParameter("author", u.getId());
        nq.setParameter("kind", kind.name());
        nq.setParameter("viewerKnown", viewerOrNull != null);
        // Postgres still binds the param even on the short-circuit branch,
        // so pass the author UUID as a stand-in when anonymous (NULL would
        // need a separate query shape).
        nq.setParameter("viewer", viewerOrNull != null ? viewerOrNull.getId() : u.getId());

        @SuppressWarnings("unchecked")
        List<Object[]> rows = nq.getResultList();
        var reports = new ArrayList<CommunityReportSummary>(rows.size());
        for (Object[] r : rows) reports.add(mapRow(r));

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
                reports
        );
    }

    // ─── helpers ────────────────────────────────────────────────────────

    private CommunityReportSummary mapRow(Object[] r) {
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
                votedByMe
        );
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
}
