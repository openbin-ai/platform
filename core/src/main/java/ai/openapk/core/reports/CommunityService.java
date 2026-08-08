package ai.openapk.core.reports;

import ai.openapk.core.auth.CurrentUserService;
import ai.openapk.core.auth.User;
import ai.openapk.core.media.MediaService;
import ai.openapk.core.projects.Project;
import ai.openapk.core.projects.ProjectKind;
import ai.openapk.core.reports.dto.AbuseReportRequest;
import ai.openapk.core.reports.dto.CommunityReportDetail;
import ai.openapk.core.reports.dto.CommunityReportSummary;
import ai.openapk.core.reports.dto.ReportSection;
import ai.openapk.core.social.FollowRepository;
import ai.openapk.core.social.ReportVoteRepository;
import jakarta.persistence.EntityManager;
import jakarta.persistence.PersistenceContext;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.server.ResponseStatusException;
import tools.jackson.core.type.TypeReference;
import tools.jackson.databind.ObjectMapper;

import java.math.BigInteger;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.sql.Timestamp;
import java.time.Instant;
import java.time.OffsetDateTime;
import java.time.ZonedDateTime;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.UUID;

/**
 * Read-side service for the anonymous {@code /api/community} feed.
 *
 * <p>Queries are intentionally native SQL — JPQL doesn't grok Postgres
 * tsvector or array operators (&amp;&amp;, @@), and the GIN indexes on
 * search_tsv + tags only get hit when the query speaks those operators
 * directly. Using JPA's spec API to fake it would be slower and harder
 * to reason about than 30 lines of carefully-typed native SQL.
 */
@Service
public class CommunityService {

    private static final Logger log = LoggerFactory.getLogger(CommunityService.class);

    /** Hard upper bound on page size — defense against an attacker asking for a million. */
    private static final int MAX_PAGE_SIZE = 50;

    /** 64-hex-char SHA-256 detected client-side; we also re-check here. */
    private static final java.util.regex.Pattern SHA256_HEX =
            java.util.regex.Pattern.compile("^[0-9a-fA-F]{64}$");

    @PersistenceContext
    private EntityManager em;

    private final ProjectReportRepository reportRepo;
    private final ObjectMapper mapper;
    private final EmailService email;
    private final MediaService mediaService;
    private final ai.openapk.core.notifications.NotificationService notifications;
    private final CurrentUserService currentUser;
    private final FollowRepository followRepo;
    private final ReportVoteRepository voteRepo;
    private final ReportContributorService contributors;

    public CommunityService(ProjectReportRepository reportRepo, ObjectMapper mapper,
                            EmailService email, MediaService mediaService,
                            ai.openapk.core.notifications.NotificationService notifications,
                            CurrentUserService currentUser, FollowRepository followRepo,
                            ReportVoteRepository voteRepo, ReportContributorService contributors) {
        this.reportRepo = reportRepo;
        this.mapper = mapper;
        this.email = email;
        this.mediaService = mediaService;
        this.notifications = notifications;
        this.currentUser = currentUser;
        this.followRepo = followRepo;
        this.voteRepo = voteRepo;
        this.contributors = contributors;
    }

    /**
     * Paginated feed of published community reports for one project kind.
     * Supports optional FTS keyword search, malware-type filter, tag
     * filter (ARRAY overlap), and exact sha256 lookup.
     *
     * @param kind APK or BIN — split feed per product surface (BIN also
     *             matches SCRIPT projects, which live on openbin)
     * @param q free-text keyword (FTS via plainto_tsquery)
     * @param malwareType STIX 2.1 malware-type filter
     * @param tags tag list for array-overlap filter
     * @param sha256 exact-hash lookup; if set, all other filters are ignored
     * @param page zero-based page index
     * @param size requested page size (capped to {@link #MAX_PAGE_SIZE})
     */
    @Transactional(readOnly = true)
    public List<CommunityReportSummary> feed(
            ProjectKind kind, String q, String malwareType, List<String> tags,
            String sha256, String sort, int page, int size
    ) {
        int limit = Math.min(Math.max(1, size), MAX_PAGE_SIZE);
        int offset = Math.max(0, page) * limit;

        // SHA-256 exact-match is short-circuit: ignore other filters since
        // a binary hash is meant to uniquely identify the sample. If the
        // input isn't 64 hex chars, treat as keyword instead. Narrow into
        // a local non-null reference so downstream flow analysis doesn't
        // re-question whether sha256 might be null.
        final String hashLookup = (sha256 != null && SHA256_HEX.matcher(sha256).matches()) ? sha256 : null;
        boolean isHashLookup = hashLookup != null;

        // Opportunistic auth: if a Bearer was sent, personalize the
        // votedByMe column. Anonymous viewers get false for every row.
        User viewer = currentUser.currentOrNull();
        UUID viewerId = viewer != null ? viewer.getId() : null;

        StringBuilder sql = new StringBuilder("""
                SELECT r.id, r.project_id, r.title, r.malware_type, r.tags, r.sections_jsonb,
                       r.community_published_at,
                       p.name AS project_name, p.sha256,
                       u.id AS author_id, u.display_name, u.email,
                       (SELECT COUNT(*) FROM report_votes v WHERE v.report_id = r.id) AS vote_count,
                       (:viewerKnown AND EXISTS (SELECT 1 FROM report_votes v2
                               WHERE v2.report_id = r.id AND v2.user_id = :viewer)) AS voted_by_me
                FROM project_reports r
                JOIN projects p ON r.project_id = p.id
                JOIN users u ON p.user_id = u.id
                WHERE r.community_published_at IS NOT NULL
                  AND p.kind = ANY(CAST(:kinds AS text[]))
                """);

        if (isHashLookup) {
            sql.append("  AND p.sha256 = :sha256\n");
        } else {
            if (q != null && !q.isBlank()) {
                sql.append("  AND r.search_tsv @@ plainto_tsquery('english', :q)\n");
            }
            if (malwareType != null && !malwareType.isBlank()) {
                sql.append("  AND r.malware_type = :malwareType\n");
            }
            if (tags != null && !tags.isEmpty()) {
                sql.append("  AND r.tags && CAST(:tags AS text[])\n");
            }
        }
        // sort=trending = upvotes DESC with recency as tiebreaker so a
        // brand-new 0-vote report isn't pinned to the bottom forever. sort
        // defaults to "new" = chronological. Whitelist-checked here so the
        // user-controlled param never reaches the ORDER BY clause raw.
        boolean trending = "trending".equalsIgnoreCase(sort);
        if (trending) {
            sql.append("ORDER BY vote_count DESC, r.community_published_at DESC ");
        } else {
            sql.append("ORDER BY r.community_published_at DESC ");
        }
        sql.append("LIMIT :limit OFFSET :offset");

        var nq = em.createNativeQuery(sql.toString());
        nq.setParameter("kinds", kind.surfaceKindsPgArray());
        nq.setParameter("limit", limit);
        nq.setParameter("offset", offset);
        nq.setParameter("viewerKnown", viewerId != null);
        // Postgres requires every named param to be bound even when the
        // EXISTS short-circuit makes the value unused — pass the all-zeros
        // UUID as a stand-in when anonymous.
        nq.setParameter("viewer", viewerId != null ? viewerId : new UUID(0L, 0L));
        if (hashLookup != null) {
            nq.setParameter("sha256", hashLookup.toLowerCase(Locale.ROOT));
        } else {
            if (q != null && !q.isBlank()) nq.setParameter("q", q);
            if (malwareType != null && !malwareType.isBlank()) nq.setParameter("malwareType", malwareType);
            if (tags != null && !tags.isEmpty()) {
                // Postgres TEXT[] literal: '{"a","b"}'. JDBC driver can take a
                // java.sql.Array but easier path is the literal string + cast.
                nq.setParameter("tags", toPgArrayLiteral(tags));
            }
        }

        @SuppressWarnings("unchecked")
        List<Object[]> rows = nq.getResultList();
        var reportIds = rows.stream().map(r -> (UUID) r[0]).toList();
        var contribByReport = contributors.forReports(reportIds);
        var out = new ArrayList<CommunityReportSummary>(rows.size());
        for (Object[] r : rows) {
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

            out.add(new CommunityReportSummary(
                    reportId, projectId, title, projectName, mt, rowTags, sha,
                    published,
                    authorId,
                    displayNameOrFallback(displayName, emailAddr),
                    md5Hex(emailAddr),
                    extractPreview(sectionsJson),
                    voteCount,
                    votedByMe,
                    contribByReport.getOrDefault(reportId, List.of())
            ));
        }
        return out;
    }

    /**
     * Single-report anonymous read. Returns 404 if not published (or
     * pretends to — leaks no distinction between "doesn't exist" and "is
     * private"). Carries enough project metadata to render the report
     * standalone without re-fetching anything user-scoped.
     */
    @Transactional(readOnly = true)
    public CommunityReportDetail read(UUID reportId) {
        ProjectReport report = reportRepo.findById(reportId)
                .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND, "report not found"));
        if (report.getCommunityPublishedAt() == null) {
            // Same response shape as not-found so we don't leak existence.
            throw new ResponseStatusException(HttpStatus.NOT_FOUND, "report not found");
        }
        Project p = report.getProject();
        // Rewrite the per-user /api/projects/{projectId}/media/{file} URLs that
        // were stored in the editor into anonymous-readable URLs scoped to
        // this report's id so signed-out community visitors can load the
        // screenshots without an Authorization header.
        List<ReportSection> sections = deserializeSections(report.getSectionsJson());
        sections = rewriteMediaUrls(sections, report.getId(), p.getId());

        User viewer = currentUser.currentOrNull();
        long voteCount = voteRepo.countByReportId(report.getId());
        boolean votedByMe = viewer != null && voteRepo.existsByUserIdAndReportId(viewer.getId(), report.getId());
        UUID authorId = p.getUser().getId();
        // amFollowingAuthor is meaningful only when the viewer is signed in
        // and the author isn't themselves — otherwise the follow button is
        // hidden anyway, so false is the right default.
        boolean amFollowingAuthor = viewer != null && !viewer.getId().equals(authorId)
                && followRepo.existsByFollowerIdAndFolloweeId(viewer.getId(), authorId);

        return new CommunityReportDetail(
                report.getId(),
                p.getId(),
                p.getKind().name(),
                report.getTitle(),
                sections,
                report.getMalwareType(),
                report.getTags() == null ? List.of() : List.of(report.getTags()),
                p.getName(),
                p.getOriginalFilename(),
                p.getSha256(),
                p.getSizeBytes(),
                p.getExecutableFormat(),
                p.getArch(),
                p.getPackageName(),
                report.getCommunityPublishedAt(),
                authorId,
                displayNameOrFallback(p.getUser().getDisplayName(), p.getUser().getEmail()),
                md5Hex(p.getUser().getEmail()),
                voteCount,
                votedByMe,
                amFollowingAuthor,
                contributors.forReport(report.getId()),
                p.getPublicReadAt()
        );
    }

    /**
     * Resolve a screenshot referenced by a community-published report.
     * Anonymous-readable: gated by (a) the report being community-published
     * and (b) the filename actually appearing in the report's section
     * content. (b) is defense-in-depth so a malicious user can't probe
     * arbitrary {@code projectId/filename} pairs through this endpoint.
     */
    @Transactional(readOnly = true)
    public MediaService.Resolved resolveMedia(UUID reportId, String filename) {
        ProjectReport report = reportRepo.findById(reportId)
                .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND, "media not found"));
        if (report.getCommunityPublishedAt() == null) {
            throw new ResponseStatusException(HttpStatus.NOT_FOUND, "media not found");
        }
        if (!sectionsReferenceFile(report.getSectionsJson(), filename)) {
            throw new ResponseStatusException(HttpStatus.NOT_FOUND, "media not found");
        }
        return mediaService.resolvePublic(report.getProject().getId(), filename);
    }

    private static final java.util.regex.Pattern MEDIA_URL =
            java.util.regex.Pattern.compile("/api/projects/([0-9a-fA-F-]{36})/media/([0-9a-f-]{36}\\.png)");

    private List<ReportSection> rewriteMediaUrls(List<ReportSection> sections, UUID reportId, UUID projectId) {
        if (sections == null || sections.isEmpty()) return sections;
        var out = new ArrayList<ReportSection>(sections.size());
        String prefix = "/api/community/reports/" + reportId + "/media/";
        for (ReportSection s : sections) {
            String c = s.content();
            if (c == null || c.isEmpty()) { out.add(s); continue; }
            java.util.regex.Matcher m = MEDIA_URL.matcher(c);
            StringBuilder sb = new StringBuilder();
            while (m.find()) {
                // Only rewrite refs to THIS project; leave foreign refs (an
                // author could in principle paste another project's URL) so
                // they break loudly instead of leaking a 404 through ours.
                String replacement = m.group(1).equalsIgnoreCase(projectId.toString())
                        ? prefix + m.group(2)
                        : m.group(0);
                m.appendReplacement(sb, java.util.regex.Matcher.quoteReplacement(replacement));
            }
            m.appendTail(sb);
            out.add(new ReportSection(s.id(), s.title(), sb.toString()));
        }
        return out;
    }

    private boolean sectionsReferenceFile(String sectionsJson, String filename) {
        if (sectionsJson == null || filename == null) return false;
        // Cheap substring check on the raw JSON is sufficient — the filename
        // is a UUID + ".png" (36-char hex pattern from validateFilename), so
        // false positives are negligible. Avoids deserializing on a hot path.
        return sectionsJson.contains(filename);
    }

    /**
     * Anonymous abuse report — emails the configured admin address via SES.
     * Doesn't write to the database; for v1 we treat these as transient
     * support tickets (future enhancement: persist with timestamp + status
     * for moderation dashboard).
     */
    @Transactional(readOnly = true)
    public void reportAbuse(UUID reportId, AbuseReportRequest req) {
        ProjectReport report = reportRepo.findById(reportId)
                .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND, "report not found"));
        if (report.getCommunityPublishedAt() == null) {
            throw new ResponseStatusException(HttpStatus.NOT_FOUND, "report not found");
        }
        email.sendAbuseReport(reportId, report.getTitle(), req.reason(), req.reporterEmail());
        // Reporter confirmation (only fires if they supplied an email). The
        // admin notification above always goes out regardless — different
        // destinations, different content.
        notifications.notifyAbuseReceived(req.reporterEmail(), reportId, report.getTitle());
    }

    /**
     * Normalize whatever the JDBC driver hands back for a TIMESTAMPTZ
     * column into a {@link Instant}. Postgres JDBC + Hibernate 7's native
     * query mapping is inconsistent — depending on the driver version and
     * the Hibernate type-contributor configuration, the value can arrive
     * as {@link Timestamp}, {@link OffsetDateTime}, {@link ZonedDateTime},
     * or {@link Instant} itself. Handle all four shapes here so the call
     * sites stay tidy.
     */
    private static Instant toInstant(Object raw) {
        if (raw == null) return null;
        if (raw instanceof Instant i) return i;
        if (raw instanceof Timestamp ts) return ts.toInstant();
        if (raw instanceof OffsetDateTime odt) return odt.toInstant();
        if (raw instanceof ZonedDateTime zdt) return zdt.toInstant();
        throw new IllegalStateException("unexpected timestamp type from JDBC: " + raw.getClass().getName());
    }

    // ---------- internals ----------

    private List<ReportSection> deserializeSections(String json) {
        if (json == null || json.isBlank()) return List.of();
        try {
            Map<String, List<ReportSection>> root =
                    mapper.readValue(json, new TypeReference<Map<String, List<ReportSection>>>() {});
            return root.getOrDefault("sections", List.of());
        } catch (Exception e) {
            log.warn("community: section deserialization failed: {}", e.toString());
            return List.of();
        }
    }

    /**
     * Public alias for {@link #extractPreview(String)} — exposed so
     * {@code SocialService} can reuse the same trimming logic on its
     * personal-feed query rows without duplicating the regex pipeline.
     */
    public String previewFromSections(String sectionsJson) {
        return extractPreview(sectionsJson);
    }

    /**
     * Trim a preview from the first non-empty section content. Strips
     * Markdown noise lightly (heading markers, bullets, code fences) so
     * the feed card shows readable text. Caps at ~240 chars.
     */
    private String extractPreview(String sectionsJson) {
        for (ReportSection s : deserializeSections(sectionsJson)) {
            String c = s.content() == null ? "" : s.content().trim();
            if (c.isEmpty()) continue;
            // Strip very common Markdown markers — full markdown render is
            // the public detail view's job, not the feed card's.
            String cleaned = c
                    .replaceAll("(?m)^#{1,6}\\s*", "")
                    .replaceAll("```[\\s\\S]*?```", "")
                    .replaceAll("(?m)^[*\\-+]\\s*", "")
                    .replaceAll("\\*\\*?([^*]+)\\*\\*?", "$1")
                    .replaceAll("\\s+", " ")
                    .trim();
            if (cleaned.isEmpty()) continue;
            return cleaned.length() <= 240 ? cleaned : cleaned.substring(0, 240) + "…";
        }
        return "";
    }

    /**
     * Convert a Postgres array literal (delivered as String or PGobject
     * depending on driver mode) into a Java List<String>. Hibernate's
     * native-query mapping isn't consistent here across drivers, so we
     * normalize both shapes.
     */
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
        // Fallback: parse "{a,b}" literal.
        String s = raw.toString();
        if (s.length() < 2 || s.charAt(0) != '{' || s.charAt(s.length() - 1) != '}') return List.of();
        String body = s.substring(1, s.length() - 1);
        if (body.isEmpty()) return List.of();
        var parts = body.split(",");
        var out = new ArrayList<String>(parts.length);
        for (String p : parts) {
            String t = p.trim();
            if (t.startsWith("\"") && t.endsWith("\"")) t = t.substring(1, t.length() - 1);
            if (!t.isEmpty()) out.add(t);
        }
        return out;
    }

    /**
     * Build a Postgres TEXT[] literal like {"a","b"} from the list. Quotes
     * each entry and escapes embedded quotes / backslashes.
     */
    private static String toPgArrayLiteral(List<String> tags) {
        var seen = new HashSet<String>();
        var sb = new StringBuilder("{");
        boolean first = true;
        for (String t : tags) {
            if (t == null) continue;
            String trimmed = t.trim().toLowerCase(Locale.ROOT);
            if (trimmed.isEmpty() || !seen.add(trimmed)) continue;
            if (!first) sb.append(',');
            sb.append('"').append(trimmed.replace("\\", "\\\\").replace("\"", "\\\"")).append('"');
            first = false;
        }
        sb.append('}');
        return sb.toString();
    }

    /**
     * Author display logic: explicit display_name wins; else the local
     * part of the email; else "anonymous researcher". Never leaks the
     * full email address publicly.
     */
    public static String displayNameOrFallback(String displayName, String emailAddr) {
        if (displayName != null && !displayName.isBlank()) return displayName;
        if (emailAddr != null && emailAddr.contains("@")) {
            return emailAddr.substring(0, emailAddr.indexOf('@'));
        }
        return "anonymous researcher";
    }

    /**
     * MD5 of trimmed lowercase email — Gravatar's identifier. We never
     * send the raw email to the frontend; only this hash. If the user has
     * no email, return a stable hash of empty string so Gravatar shows
     * the identicon for "no email."
     */
    public static String md5Hex(String emailAddr) {
        String input = (emailAddr == null ? "" : emailAddr.trim().toLowerCase(Locale.ROOT));
        try {
            byte[] digest = MessageDigest.getInstance("MD5").digest(input.getBytes(StandardCharsets.UTF_8));
            return String.format("%032x", new BigInteger(1, digest));
        } catch (NoSuchAlgorithmException e) {
            // MD5 is mandatory in every JRE per spec — this branch is unreachable.
            throw new IllegalStateException("MD5 unavailable", e);
        }
    }

}
