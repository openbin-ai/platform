package ai.openapk.core.social;

import ai.openapk.core.auth.User;
import ai.openapk.core.notifications.NotificationService;
import ai.openapk.core.reports.CommunityService;
import ai.openapk.core.reports.ProjectReport;
import ai.openapk.core.reports.ProjectReportRepository;
import ai.openapk.core.social.dto.CommentResponse;
import ai.openapk.core.social.dto.CreateCommentRequest;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.server.ResponseStatusException;

import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;

/**
 * Comment thread CRUD on community-published reports. Reads are anonymous
 * with opportunistic personalization (the {@code mine} flag on each
 * response); writes require auth and a community-visible report.
 *
 * <p>Threads nest to arbitrary depth (Reddit-style); the frontend caps the
 * visual indent and offers "continue thread" beyond it. Root comments are
 * ordered by the requested sort (new / top / hot); replies within a thread
 * stay chronological.
 */
@Service
public class CommentsService {

    private final ReportCommentRepository repo;
    private final ProjectReportRepository reportRepo;
    private final NotificationService notifications;

    public CommentsService(ReportCommentRepository repo, ProjectReportRepository reportRepo,
                           NotificationService notifications) {
        this.repo = repo;
        this.reportRepo = reportRepo;
        this.notifications = notifications;
    }

    /**
     * Tree of comments for the given report. Top-level rows come back with
     * their replies attached in chronological order. Hidden behind 404 if
     * the report isn't community-published — anonymous probers can't tell
     * "private report" from "doesn't exist".
     */
    @Transactional(readOnly = true)
    public List<CommentResponse> list(UUID reportId, User viewerOrNull, String sort) {
        ProjectReport report = reportRepo.findById(reportId).orElseThrow(() ->
                new ResponseStatusException(HttpStatus.NOT_FOUND, "report not found"));
        if (report.getCommunityPublishedAt() == null) {
            throw new ResponseStatusException(HttpStatus.NOT_FOUND, "report not found");
        }

        // Fetch chronologically so replies attach + render oldest-first within
        // each thread regardless of the root-level sort.
        List<ReportComment> flat = repo.findAllByReportIdOrderByCreatedAtAsc(reportId);
        UUID viewerId = viewerOrNull == null ? null : viewerOrNull.getId();

        Map<UUID, CommentResponse> byId = new HashMap<>(flat.size());
        Map<UUID, List<CommentResponse>> repliesByParent = new HashMap<>();
        List<CommentResponse> roots = new ArrayList<>();

        for (ReportComment c : flat) {
            CommentResponse resp = toResponse(c, viewerId, new ArrayList<>());
            byId.put(c.getId(), resp);
            UUID parentId = c.getParent() == null ? null : c.getParent().getId();
            if (parentId == null) {
                roots.add(resp);
            } else {
                repliesByParent.computeIfAbsent(parentId, k -> new ArrayList<>()).add(resp);
            }
        }
        // Attach children to their parent at any depth (arbitrary nesting).
        for (var entry : repliesByParent.entrySet()) {
            CommentResponse parent = byId.get(entry.getKey());
            if (parent != null) parent.replies().addAll(entry.getValue());
        }

        sortRoots(roots, sort);
        return roots;
    }

    /**
     * Order the root comments. "new" = newest first; "top" = busiest thread
     * (most total descendants) first; "hot" (default) = engagement decayed by
     * age, HN-style, so a fresh active thread outranks an old busy one.
     * Replies within a thread stay chronological. Comment-level voting would
     * sharpen these signals — deferred; descendant count is the proxy today.
     */
    private void sortRoots(List<CommentResponse> roots, String sort) {
        String s = sort == null ? "hot" : sort.toLowerCase(java.util.Locale.ROOT);
        java.util.Comparator<CommentResponse> cmp = switch (s) {
            case "new" -> java.util.Comparator.comparing(
                    (CommentResponse c) -> c.createdAt(), java.util.Comparator.nullsLast(java.util.Comparator.naturalOrder())).reversed();
            case "top" -> java.util.Comparator.comparingLong((CommentResponse c) -> descendantCount(c)).reversed()
                    .thenComparing(c -> c.createdAt(), java.util.Comparator.nullsLast(java.util.Comparator.reverseOrder()));
            default -> java.util.Comparator.comparingDouble((CommentResponse c) -> hotScore(c)).reversed();
        };
        roots.sort(cmp);
    }

    private static long descendantCount(CommentResponse c) {
        long n = 0;
        for (CommentResponse r : c.replies()) n += 1 + descendantCount(r);
        return n;
    }

    /** HN-style: (engagement + 1) decayed by age^1.5. */
    private static double hotScore(CommentResponse c) {
        double engagement = descendantCount(c) + 1.0;
        double ageHours = c.createdAt() == null ? 0.0
                : Math.max(0.0, (System.currentTimeMillis() - c.createdAt().toEpochMilli()) / 3_600_000.0);
        return engagement / Math.pow(ageHours + 2.0, 1.5);
    }

    /**
     * Create a comment. Returns the new comment's response shape. Fires
     * two best-effort notifications:
     * <ul>
     *   <li>"comment on my report" to the report author (skipped if the
     *       commenter IS the report author — no self-ping)</li>
     *   <li>"reply to my comment" to the parent commenter when a parent
     *       is set and the replier isn't that same user</li>
     * </ul>
     */
    @Transactional
    public CommentResponse create(User author, CreateCommentRequest req) {
        if (req == null || req.body() == null || req.body().isBlank()) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "comment body required");
        }
        ProjectReport report = reportRepo.findById(req.reportId()).orElseThrow(() ->
                new ResponseStatusException(HttpStatus.NOT_FOUND, "report not found"));
        if (report.getCommunityPublishedAt() == null) {
            throw new ResponseStatusException(HttpStatus.NOT_FOUND, "report not found");
        }

        ReportComment parent = null;
        if (req.parentCommentId() != null) {
            parent = repo.findById(req.parentCommentId()).orElseThrow(() ->
                    new ResponseStatusException(HttpStatus.NOT_FOUND, "parent comment not found"));
            if (!parent.getReport().getId().equals(report.getId())) {
                throw new ResponseStatusException(HttpStatus.BAD_REQUEST,
                        "parent comment belongs to a different report");
            }
            // Arbitrary nesting depth (Reddit-style). No cycle risk: the new
            // comment can't yet be anyone's ancestor, and the parent is
            // confirmed to belong to this report. The frontend caps the
            // *visual* indent and offers "continue thread" past that.
        }

        ReportComment c = new ReportComment();
        c.setReport(report);
        c.setUser(author);
        c.setParent(parent);
        // Trim trailing whitespace; preserve the user's internal newlines.
        c.setBody(req.body().strip());
        repo.save(c);

        // Notifications fire after the row is persisted so a rollback
        // can't strand emails for a comment that doesn't exist. Best-effort
        // — failure inside notify methods is swallowed there.
        User reportAuthor = report.getProject().getUser();
        if (reportAuthor != null && !reportAuthor.getId().equals(author.getId())) {
            notifications.notifyCommentOnMyReport(reportAuthor, author, report);
        }
        if (parent != null && parent.getUser() != null
                && !parent.getUser().getId().equals(author.getId())
                && (reportAuthor == null || !parent.getUser().getId().equals(reportAuthor.getId()))) {
            // Skip parent-author notify if it'd duplicate the report-author
            // notify (someone replying to the report author's own comment).
            notifications.notifyReplyToMyComment(parent.getUser(), author, report);
        }

        return toResponse(c, author.getId(), new ArrayList<>());
    }

    /**
     * Soft-delete. Only the comment's author can delete it. We don't allow
     * report authors to delete other people's comments — that's what the
     * abuse-report flow is for; centralizing moderation through one path
     * keeps the audit trail consistent.
     */
    @Transactional
    public void softDelete(User caller, UUID commentId) {
        ReportComment c = repo.findById(commentId).orElseThrow(() ->
                new ResponseStatusException(HttpStatus.NOT_FOUND, "comment not found"));
        if (!c.getUser().getId().equals(caller.getId())) {
            // Don't leak existence — return the same 404 a non-existent
            // comment would give.
            throw new ResponseStatusException(HttpStatus.NOT_FOUND, "comment not found");
        }
        if (c.getDeletedAt() != null) return;
        c.setDeletedAt(java.time.Instant.now());
        repo.save(c);
    }

    /** Per-report aggregate badge ("12 comments"). */
    @Transactional(readOnly = true)
    public long count(UUID reportId) {
        return repo.countByReportId(reportId);
    }

    // ─── helpers ────────────────────────────────────────────────────────

    private CommentResponse toResponse(ReportComment c, UUID viewerId, List<CommentResponse> replies) {
        boolean deleted = c.getDeletedAt() != null;
        User author = c.getUser();
        String displayName = deleted ? "[deleted]"
                : displayNameOrFallback(author.getDisplayName(), author.getEmail());
        String emailMd5 = deleted ? "" : CommunityService.md5Hex(author.getEmail());
        String body = deleted ? "[deleted]" : c.getBody();
        boolean mine = !deleted && viewerId != null && viewerId.equals(author.getId());
        return new CommentResponse(
                c.getId(),
                c.getReport().getId(),
                c.getParent() == null ? null : c.getParent().getId(),
                deleted ? null : author.getId(),
                displayName,
                emailMd5,
                body,
                c.getCreatedAt(),
                deleted,
                mine,
                replies
        );
    }

    private static String displayNameOrFallback(String displayName, String email) {
        if (displayName != null && !displayName.isBlank()) return displayName;
        if (email != null && email.contains("@")) {
            return email.substring(0, email.indexOf('@'));
        }
        return "anonymous researcher";
    }
}
