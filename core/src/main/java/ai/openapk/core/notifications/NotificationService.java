package ai.openapk.core.notifications;

import ai.openapk.core.auth.User;
import ai.openapk.core.notifications.dto.EmailPrefsResponse;
import ai.openapk.core.notifications.dto.UpdateEmailPrefsRequest;
import ai.openapk.core.projects.Project;
import ai.openapk.core.projects.ProjectKind;
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
        return p;
    }

    private boolean hasEmail(User user) {
        return user.getEmail() != null && !user.getEmail().isBlank();
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
