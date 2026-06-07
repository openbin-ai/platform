package ai.openapk.core.notifications;

import ai.openapk.core.auth.User;
import ai.openapk.core.notifications.dto.EmailPrefsResponse;
import ai.openapk.core.notifications.dto.UpdateEmailPrefsRequest;
import ai.openapk.core.projects.Project;
import ai.openapk.core.projects.ProjectKind;
import ai.openapk.core.projects.ProjectRole;
import ai.openapk.core.reports.CommunityService;
import ai.openapk.core.reports.EmailService;
import ai.openapk.core.reports.ProjectReport;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;
import tools.jackson.databind.ObjectMapper;

import java.util.LinkedHashMap;
import java.util.Map;
import java.util.UUID;

/**
 * Thin orchestrator that wraps {@link EmailService}. Every send goes through
 * here so the per-user opt-out gate ({@link UserEmailPrefs}) is enforced in
 * one place — services elsewhere call e.g. {@link #notifyDecompileComplete}
 * and don't need to know about prefs at all.
 *
 * <p>All send paths are best-effort: if SES is misconfigured, the user is
 * unreachable, or the prefs read fails, we log and return rather than
 * propagating a failure back into the caller's transaction. A bounced
 * "decompile done" email shouldn't roll back the decompile itself.
 *
 * <p>Each notify method runs in {@code REQUIRES_NEW} so a rolled-back outer
 * tx (e.g. the publish call later throws) doesn't strand us mid-send;
 * mirrors {@link ai.openapk.core.usage.LlmUsageService}'s audit pattern.
 */
@Service
public class NotificationService {

    private static final Logger log = LoggerFactory.getLogger(NotificationService.class);

    private final UserEmailPrefsRepository prefsRepo;
    private final EmailService email;
    private final NotificationRepository notifRepo;
    private final ObjectMapper mapper;

    public NotificationService(UserEmailPrefsRepository prefsRepo, EmailService email,
                               NotificationRepository notifRepo, ObjectMapper mapper) {
        this.prefsRepo = prefsRepo;
        this.email = email;
        this.notifRepo = notifRepo;
        this.mapper = mapper;
    }

    // ----------------------------------------------------------------------
    // Send paths
    // ----------------------------------------------------------------------

    @Transactional(propagation = Propagation.REQUIRES_NEW)
    public void notifyDecompileComplete(User user, Project project) {
        if (user == null || project == null) return;
        if (!hasEmail(user)) return;
        if (!getOrDefault(user.getId()).isNotifyDecompileComplete()) return;
        safeSend("decompile-complete", () ->
                email.sendDecompileComplete(user.getEmail(), project.getName(),
                        project.getKind(), project.getId()));
    }

    @Transactional(propagation = Propagation.REQUIRES_NEW)
    public void notifyReportPublished(User user, ProjectReport report) {
        if (user == null || report == null) return;
        if (!hasEmail(user)) return;
        if (!getOrDefault(user.getId()).isNotifyReportPublished()) return;
        safeSend("report-published", () ->
                email.sendReportPublished(user.getEmail(), report.getTitle(), report.getId()));
    }

    /**
     * Confirmation to a (possibly anonymous) abuse reporter. No prefs lookup
     * because the reporter may not be a registered user — we use the email
     * they typed into the form. Skipped entirely when they didn't supply one.
     */
    public void notifyAbuseReceived(String reporterEmail, UUID reportId, String reportTitle) {
        if (reporterEmail == null || reporterEmail.isBlank()) return;
        safeSend("abuse-confirmation", () ->
                email.sendAbuseReportConfirmation(reporterEmail, reportId, reportTitle));
    }

    /**
     * "X started following you." Skipped if {@code follower == followee}
     * (defense in depth — the DB CHECK already prevents this, but it's
     * cheap to short-circuit here too).
     */
    @Transactional(propagation = Propagation.REQUIRES_NEW)
    public void notifyNewFollower(User followee, User follower) {
        if (followee == null || follower == null) return;
        if (followee.getId().equals(follower.getId())) return;
        // In-app gating skips the hasEmail check — a user can receive bell
        // notifications even if their email is missing/blank. The pref
        // toggle still gates both channels.
        if (!getOrDefault(followee.getId()).isNotifyNewFollower()) return;
        if (hasEmail(followee)) {
            safeSend("new-follower", () ->
                    email.sendNewFollower(followee.getEmail(),
                            displayNameFor(follower),
                            follower.getId()));
        }
        createInApp(followee, "NEW_FOLLOWER",
                actorPayload(follower),
                "/u/" + follower.getId());
    }

    /**
     * "X commented on your report." Caller is responsible for ensuring the
     * commenter isn't the report author (no self-ping); we still guard
     * here so a future caller can't accidentally bypass it.
     */
    @Transactional(propagation = Propagation.REQUIRES_NEW)
    public void notifyCommentOnMyReport(User reportAuthor, User commenter, ProjectReport report) {
        if (reportAuthor == null || commenter == null || report == null) return;
        if (reportAuthor.getId().equals(commenter.getId())) return;
        if (!getOrDefault(reportAuthor.getId()).isNotifyCommentOnMyReport()) return;
        if (hasEmail(reportAuthor)) {
            safeSend("comment-on-my-report", () ->
                    email.sendCommentOnMyReport(reportAuthor.getEmail(),
                            displayNameFor(commenter),
                            report.getTitle(),
                            report.getId()));
        }
        var payload = actorPayload(commenter);
        payload.put("reportId", report.getId().toString());
        payload.put("reportTitle", report.getTitle());
        createInApp(reportAuthor, "COMMENT_ON_MY_REPORT",
                payload,
                "/community/reports/" + report.getId());
    }

    /**
     * "X replied to your comment on report Y." The caller verifies the
     * recipient isn't the replier or the report author (the latter would
     * already get the comment-on-my-report notify).
     */
    @Transactional(propagation = Propagation.REQUIRES_NEW)
    public void notifyReplyToMyComment(User parentAuthor, User replier, ProjectReport report) {
        if (parentAuthor == null || replier == null || report == null) return;
        if (parentAuthor.getId().equals(replier.getId())) return;
        if (!getOrDefault(parentAuthor.getId()).isNotifyReplyToMyComment()) return;
        if (hasEmail(parentAuthor)) {
            safeSend("reply-to-my-comment", () ->
                    email.sendReplyToMyComment(parentAuthor.getEmail(),
                            displayNameFor(replier),
                            report.getTitle(),
                            report.getId()));
        }
        var payload = actorPayload(replier);
        payload.put("reportId", report.getId().toString());
        payload.put("reportTitle", report.getTitle());
        createInApp(parentAuthor, "REPLY_TO_MY_COMMENT",
                payload,
                "/community/reports/" + report.getId());
    }

    /**
     * "X invited you to collaborate on project Y as VIEWER/EDITOR." Fires
     * from {@link ai.openapk.core.projects.ProjectCollaboratorService#add}
     * after the row is persisted.
     */
    @Transactional(propagation = Propagation.REQUIRES_NEW)
    public void notifyCollaboratorInvite(User invitee, User inviter, Project project, ProjectRole role) {
        if (invitee == null || inviter == null || project == null || role == null) return;
        if (invitee.getId().equals(inviter.getId())) return;
        if (!getOrDefault(invitee.getId()).isNotifyCollaboratorInvite()) return;
        if (hasEmail(invitee)) {
            safeSend("collaborator-invite", () ->
                    email.sendCollaboratorInvite(invitee.getEmail(),
                            displayNameFor(inviter),
                            project.getName(),
                            project.getKind(),
                            project.getId(),
                            role.name()));
        }
        var payload = actorPayload(inviter);
        payload.put("projectId", project.getId().toString());
        payload.put("projectName", project.getName());
        payload.put("projectKind", project.getKind().name());
        payload.put("role", role.name());
        createInApp(invitee, "COLLABORATOR_INVITE",
                payload,
                "/projects/" + project.getId());
    }

    // ----------------------------------------------------------------------
    // Settings API (GET + PATCH)
    // ----------------------------------------------------------------------

    @Transactional(readOnly = true)
    public EmailPrefsResponse currentPrefs(User user) {
        return EmailPrefsResponse.from(prefsRepo.findById(user.getId()).orElse(null));
    }

    @Transactional
    public EmailPrefsResponse updatePrefs(User user, UpdateEmailPrefsRequest req) {
        UserEmailPrefs p = prefsRepo.findById(user.getId()).orElseGet(() -> {
            var fresh = new UserEmailPrefs();
            fresh.setUser(user);
            return fresh;
        });
        if (req.notifyDecompileComplete() != null) p.setNotifyDecompileComplete(req.notifyDecompileComplete());
        if (req.notifyReportPublished()   != null) p.setNotifyReportPublished(req.notifyReportPublished());
        if (req.notifyAbuseConfirmation() != null) p.setNotifyAbuseConfirmation(req.notifyAbuseConfirmation());
        if (req.notifyNewFollower()       != null) p.setNotifyNewFollower(req.notifyNewFollower());
        if (req.notifyCommentOnMyReport() != null) p.setNotifyCommentOnMyReport(req.notifyCommentOnMyReport());
        if (req.notifyReplyToMyComment()  != null) p.setNotifyReplyToMyComment(req.notifyReplyToMyComment());
        if (req.notifyCollaboratorInvite()!= null) p.setNotifyCollaboratorInvite(req.notifyCollaboratorInvite());
        prefsRepo.save(p);
        return EmailPrefsResponse.from(p);
    }

    // ----------------------------------------------------------------------
    // helpers
    // ----------------------------------------------------------------------

    private UserEmailPrefs getOrDefault(UUID userId) {
        return prefsRepo.findById(userId).orElseGet(this::defaultPrefs);
    }

    private UserEmailPrefs defaultPrefs() {
        var p = new UserEmailPrefs();
        p.setNotifyDecompileComplete(true);
        p.setNotifyReportPublished(true);
        p.setNotifyAbuseConfirmation(true);
        p.setNotifyNewFollower(true);
        p.setNotifyCommentOnMyReport(true);
        p.setNotifyReplyToMyComment(true);
        p.setNotifyCollaboratorInvite(true);
        return p;
    }

    private boolean hasEmail(User user) {
        return user.getEmail() != null && !user.getEmail().isBlank();
    }

    /**
     * What to call the *actor* in email subject lines (the person who
     * followed / commented / invited). Explicit display name wins, else
     * the local part of their email, else a generic fallback.
     */
    private static String displayNameFor(User u) {
        if (u == null) return "Someone";
        if (u.getDisplayName() != null && !u.getDisplayName().isBlank()) return u.getDisplayName();
        String e = u.getEmail();
        if (e != null && e.contains("@")) return e.substring(0, e.indexOf('@'));
        return "Someone";
    }

    /**
     * Common header on every in-app payload — the bell-dropdown row
     * needs the actor's avatar + label without a follow-up user lookup.
     * Returned as a mutable map so callers can stir in kind-specific
     * fields (reportTitle, projectName, etc.) without an extra builder.
     */
    private static Map<String, String> actorPayload(User actor) {
        var p = new LinkedHashMap<String, String>();
        p.put("actorId", actor == null ? "" : actor.getId().toString());
        p.put("actorDisplayName", displayNameFor(actor));
        p.put("actorEmailMd5", CommunityService.md5Hex(actor == null ? null : actor.getEmail()));
        return p;
    }

    /**
     * Persist one bell-dropdown row. JSON-serialization is best-effort —
     * a payload that can't be encoded is logged and swallowed so the
     * outer notify call still completes the email send.
     */
    private void createInApp(User recipient, String kind, Map<String, String> payload, String link) {
        if (recipient == null) return;
        try {
            String json = mapper.writeValueAsString(payload);
            Notification n = new Notification();
            n.setUser(recipient);
            n.setKind(kind);
            n.setPayload(json);
            n.setLink(link);
            notifRepo.save(n);
        } catch (RuntimeException e) {
            log.warn("[notify] in-app dispatch failed kind={}: {}", kind, e.toString());
        }
    }

    private void safeSend(String label, Runnable r) {
        try {
            r.run();
        } catch (RuntimeException e) {
            log.warn("[notify] {} dispatch failed: {}", label, e.toString());
        }
    }

    // Exposed so other Spring-managed services don't accidentally bypass the
    // gate by injecting EmailService directly. Kept package-private; intended
    // for tests that need a hand on the underlying client.
    ProjectKind probeKind(ProjectKind k) {
        return k;
    }
}
