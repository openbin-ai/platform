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
 * <p>Threading depth is hard-capped at one level — a reply to a reply gets
 * its parent re-pointed to the original top-level comment so visually
 * deep chains can't form. This matches the V28 schema's implicit contract
 * (no cycle detection because depth is always 0 or 1).
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
    public List<CommentResponse> list(UUID reportId, User viewerOrNull) {
        ProjectReport report = reportRepo.findById(reportId).orElseThrow(() ->
                new ResponseStatusException(HttpStatus.NOT_FOUND, "report not found"));
        if (report.getCommunityPublishedAt() == null) {
            throw new ResponseStatusException(HttpStatus.NOT_FOUND, "report not found");
        }

        List<ReportComment> flat = repo.findAllByReportIdOrderByCreatedAtAsc(reportId);
        UUID viewerId = viewerOrNull == null ? null : viewerOrNull.getId();

        // Index by id for parent lookup; track top-level rows in order so
        // the response preserves chronological ordering at the root level.
        Map<UUID, CommentResponse> byId = new HashMap<>(flat.size());
        Map<UUID, List<CommentResponse>> repliesByParent = new HashMap<>();
        List<CommentResponse> roots = new ArrayList<>();

        for (ReportComment c : flat) {
            CommentResponse resp = toResponse(c, viewerId, new ArrayList<>());
            byId.put(c.getId(), resp);
            if (c.getParent() == null) {
                roots.add(resp);
            } else {
                repliesByParent.computeIfAbsent(c.getParent().getId(), k -> new ArrayList<>()).add(resp);
            }
        }
        // Wire children — we mutated the response's reply list reference
        // when we constructed it, so attaching here keeps the public DTO
        // shape (record) safely immutable from the outside.
        for (var entry : repliesByParent.entrySet()) {
            CommentResponse parent = byId.get(entry.getKey());
            if (parent != null) parent.replies().addAll(entry.getValue());
        }

        return roots;
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
            // Flatten the depth — a reply to a reply gets re-pointed at
            // the original top-level so the thread never exceeds depth 1.
            if (parent.getParent() != null) {
                parent = parent.getParent();
            }
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
