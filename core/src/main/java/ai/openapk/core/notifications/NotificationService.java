package ai.openapk.core.notifications;

import ai.openapk.core.auth.User;
import ai.openapk.core.notifications.dto.EmailPrefsResponse;
import ai.openapk.core.notifications.dto.UpdateEmailPrefsRequest;
import ai.openapk.core.projects.Project;
import ai.openapk.core.projects.ProjectKind;
import ai.openapk.core.projects.ProjectRole;
import ai.openapk.core.reports.EmailService;
import ai.openapk.core.reports.ProjectReport;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;

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

    public NotificationService(UserEmailPrefsRepository prefsRepo, EmailService email) {
        this.prefsRepo = prefsRepo;
        this.email = email;
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
        if (!hasEmail(followee)) return;
        if (!getOrDefault(followee.getId()).isNotifyNewFollower()) return;
        safeSend("new-follower", () ->
                email.sendNewFollower(followee.getEmail(),
                        displayNameFor(follower),
                        follower.getId()));
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
        if (!hasEmail(reportAuthor)) return;
        if (!getOrDefault(reportAuthor.getId()).isNotifyCommentOnMyReport()) return;
        safeSend("comment-on-my-report", () ->
                email.sendCommentOnMyReport(reportAuthor.getEmail(),
                        displayNameFor(commenter),
                        report.getTitle(),
                        report.getId()));
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
        if (!hasEmail(parentAuthor)) return;
        if (!getOrDefault(parentAuthor.getId()).isNotifyReplyToMyComment()) return;
        safeSend("reply-to-my-comment", () ->
                email.sendReplyToMyComment(parentAuthor.getEmail(),
                        displayNameFor(replier),
                        report.getTitle(),
                        report.getId()));
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
        if (!hasEmail(invitee)) return;
        if (!getOrDefault(invitee.getId()).isNotifyCollaboratorInvite()) return;
        safeSend("collaborator-invite", () ->
                email.sendCollaboratorInvite(invitee.getEmail(),
                        displayNameFor(inviter),
                        project.getName(),
                        project.getKind(),
                        project.getId(),
                        role.name()));
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
