package ai.openapk.core.reports;

import ai.openapk.core.config.OpenApkProperties;
import ai.openapk.core.projects.ProjectKind;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;
import software.amazon.awssdk.regions.Region;
import software.amazon.awssdk.services.sesv2.SesV2Client;
import software.amazon.awssdk.services.sesv2.model.Body;
import software.amazon.awssdk.services.sesv2.model.Content;
import software.amazon.awssdk.services.sesv2.model.Destination;
import software.amazon.awssdk.services.sesv2.model.EmailContent;
import software.amazon.awssdk.services.sesv2.model.Message;
import software.amazon.awssdk.services.sesv2.model.SendEmailRequest;

import java.util.UUID;

/**
 * Outbound email — currently used only by the anonymous abuse-report flow
 * but designed to grow into queue-position notifications and other
 * transactional emails the product will need.
 *
 * <p>The SES client is lazy: if {@code openapk.email.region} or
 * {@code openapk.email.abuse-to} is blank (typical dev), every send is a
 * no-op that logs at INFO and returns. This keeps local development free
 * of AWS-credential setup while making prod-style sending automatic when
 * the env vars land.
 */
@Service
public class EmailService {

    private static final Logger log = LoggerFactory.getLogger(EmailService.class);

    private final OpenApkProperties.Email cfg;
    private volatile SesV2Client client;

    public EmailService(OpenApkProperties props) {
        this.cfg = props.email();
    }

    /**
     * Send the abuse-report email. Body is plain text; we don't compose
     * HTML because abuse reports go to a human inbox where plain text is
     * just as readable and avoids inadvertently rendering whatever the
     * reporter pasted into the reason field.
     */
    public void sendAbuseReport(UUID reportId, String reportTitle, String reason, String reporterEmail) {
        if (!isConfigured()) {
            log.info("[email] abuse-report SKIPPED (no SES config) report={} reporter={} reason={}",
                    reportId, reporterEmail == null ? "anonymous" : reporterEmail,
                    truncate(reason, 200));
            return;
        }
        String subject = "[abuse] community report flagged: " + safe(reportTitle, 120);
        String body = """
                A community report has been flagged.

                Report ID: %s
                Title: %s

                Reporter: %s

                Reason:
                %s
                """.formatted(
                reportId,
                safe(reportTitle, 200),
                reporterEmail == null || reporterEmail.isBlank() ? "(anonymous)" : reporterEmail,
                safe(reason, 2000)
        );
        try {
            sesClient().sendEmail(SendEmailRequest.builder()
                    .fromEmailAddress(cfg.abuseFrom())
                    .destination(Destination.builder().toAddresses(cfg.abuseTo()).build())
                    .content(EmailContent.builder()
                            .simple(Message.builder()
                                    .subject(Content.builder().data(subject).build())
                                    .body(Body.builder()
                                            .text(Content.builder().data(body).build())
                                            .build())
                                    .build())
                            .build())
                    .build());
            log.info("[email] abuse-report SENT report={}", reportId);
        } catch (RuntimeException e) {
            // SES failures are not user-facing — the abuse-report endpoint
            // still returns 200 so a malicious reporter can't probe outage
            // state. Log loudly for ops.
            log.error("[email] abuse-report FAILED report={}: {}", reportId, e.toString());
        }
    }

    /**
     * Transactional confirmation that a decompile finished and the project
     * is ready to view. Sent for both APK (JADX) and BIN (CLI ingest) flows;
     * frontend URL differs per kind so the user clicks straight into the
     * right SPA.
     */
    public void sendDecompileComplete(String toAddress, String projectName, ProjectKind kind, UUID projectId) {
        if (!isConfigured()) {
            log.info("[email] decompile-complete SKIPPED (no SES config) to={} project={}", toAddress, projectId);
            return;
        }
        String url = projectUrlFor(kind, projectId);
        String subject = "Decompile finished: " + safe(projectName, 120);
        String body = """
                Your project is ready to view.

                Project: %s
                Open it here: %s

                You can turn these emails off anytime in Settings → Email preferences.
                """.formatted(safe(projectName, 200), url);
        sendTransactional(toAddress, subject, body, "decompile-complete project=" + projectId);
    }

    /**
     * Transactional confirmation that a community report was published. The
     * URL is the public community-feed path so the author can share it.
     */
    public void sendReportPublished(String toAddress, String reportTitle, UUID reportId) {
        if (!isConfigured()) {
            log.info("[email] report-published SKIPPED (no SES config) to={} report={}", toAddress, reportId);
            return;
        }
        String url = "https://openbin.ai/community/reports/" + reportId;
        String subject = "Report published: " + safe(reportTitle, 120);
        String body = """
                Your report is live in the community feed.

                Title: %s
                Public link: %s

                You can unpublish it any time from the report page. Turn these
                emails off in Settings → Email preferences.
                """.formatted(safe(reportTitle, 200), url);
        sendTransactional(toAddress, subject, body, "report-published report=" + reportId);
    }

    /**
     * Sends a "we received your abuse report" confirmation to the reporter.
     * Only fires when the reporter supplied an email (anonymous reporters
     * get nothing). Kept short so a malicious reporter can't weaponize this
     * into a spam echo at a victim's inbox.
     */
    public void sendAbuseReportConfirmation(String toAddress, UUID reportId, String reportTitle) {
        if (!isConfigured()) {
            log.info("[email] abuse-confirmation SKIPPED (no SES config) to={} report={}", toAddress, reportId);
            return;
        }
        String subject = "Abuse report received";
        String body = """
                Thanks — we received your abuse report.

                Report flagged: %s

                A human will review it. We don't reply to every report
                individually; if action is taken, you may see the content
                disappear from the community feed.
                """.formatted(safe(reportTitle, 200));
        sendTransactional(toAddress, subject, body, "abuse-confirmation report=" + reportId);
    }

    /**
     * "X started following you." Links to the follower's public profile
     * so the recipient can decide whether to follow back. Profile URLs
     * live on openapk.ai (the APK product is the primary surface for
     * researcher profiles); a future per-product fork can pass {@code kind}
     * if the profile pages diverge.
     */
    public void sendNewFollower(String toAddress, String followerName, UUID followerId) {
        if (!isConfigured()) {
            log.info("[email] new-follower SKIPPED (no SES config) to={} follower={}", toAddress, followerId);
            return;
        }
        String url = "https://openapk.ai/u/" + followerId;
        String subject = followerName + " started following you";
        String body = """
                %s is now following your community research on OpenBin.

                See their profile: %s

                Turn off follower notifications in Settings → Email preferences.
                """.formatted(safe(followerName, 100), url);
        sendTransactional(toAddress, subject, body, "new-follower follower=" + followerId);
    }

    /**
     * "X commented on your report." Deep-links to the public report page
     * so the recipient sees the comment in context. The comment body itself
     * isn't included — replies can be long and we'd rather the user click
     * through to the threaded view than read a wall of text in their inbox.
     */
    public void sendCommentOnMyReport(String toAddress, String commenterName, String reportTitle, UUID reportId) {
        if (!isConfigured()) {
            log.info("[email] comment-on-report SKIPPED (no SES config) to={} report={}", toAddress, reportId);
            return;
        }
        String url = "https://openbin.ai/community/reports/" + reportId;
        String subject = commenterName + " commented on " + safe(reportTitle, 80);
        String body = """
                %s left a comment on your community report.

                Report: %s
                Read it here: %s

                Turn off comment notifications in Settings → Email preferences.
                """.formatted(safe(commenterName, 100), safe(reportTitle, 200), url);
        sendTransactional(toAddress, subject, body, "comment-on-report report=" + reportId);
    }

    /**
     * "X replied to your comment on report Y." Same deep link as the
     * comment-on-report notify because Patternfly-style comment threads
     * are rendered inline on the report page; we don't anchor to the
     * specific comment id (would require a fragment in the URL and the
     * frontend doesn't auto-scroll yet).
     */
    public void sendReplyToMyComment(String toAddress, String replierName, String reportTitle, UUID reportId) {
        if (!isConfigured()) {
            log.info("[email] reply-to-comment SKIPPED (no SES config) to={} report={}", toAddress, reportId);
            return;
        }
        String url = "https://openbin.ai/community/reports/" + reportId;
        String subject = replierName + " replied to your comment";
        String body = """
                %s replied to your comment on a community report.

                Report: %s
                See the reply: %s

                Turn off reply notifications in Settings → Email preferences.
                """.formatted(safe(replierName, 100), safe(reportTitle, 200), url);
        sendTransactional(toAddress, subject, body, "reply-to-comment report=" + reportId);
    }

    /**
     * "X invited you to collaborate on project Y as VIEWER/EDITOR." Routes
     * to the right product surface by project kind — APK projects open on
     * openapk.ai, BIN on app.openbin.ai. Both products share the auth
     * realm so a single sign-in lets the invitee land on either.
     */
    public void sendCollaboratorInvite(String toAddress, String inviterName, String projectName,
                                       ProjectKind kind, UUID projectId, String role) {
        if (!isConfigured()) {
            log.info("[email] collaborator-invite SKIPPED (no SES config) to={} project={}", toAddress, projectId);
            return;
        }
        String url = projectUrlFor(kind, projectId);
        String roleLabel = "EDITOR".equals(role) ? "an editor" : "a viewer";
        String subject = inviterName + " invited you to " + safe(projectName, 80);
        String body = """
                %s added you to a project as %s on OpenBin.

                Project: %s
                Open it: %s

                Turn off invite notifications in Settings → Email preferences.
                """.formatted(safe(inviterName, 100), roleLabel, safe(projectName, 200), url);
        sendTransactional(toAddress, subject, body, "collaborator-invite project=" + projectId);
    }

    /**
     * Shared sendEmail wrapper used by every transactional path. From/region
     * come from {@code openapk.email.abuseFrom} for now — there's no
     * separate "noreply" identity in SES yet; revisit when we verify a
     * second sender domain.
     */
    private void sendTransactional(String toAddress, String subject, String body, String label) {
        try {
            sesClient().sendEmail(SendEmailRequest.builder()
                    .fromEmailAddress(cfg.abuseFrom())
                    .destination(Destination.builder().toAddresses(toAddress).build())
                    .content(EmailContent.builder()
                            .simple(Message.builder()
                                    .subject(Content.builder().data(subject).build())
                                    .body(Body.builder()
                                            .text(Content.builder().data(body).build())
                                            .build())
                                    .build())
                            .build())
                    .build());
            log.info("[email] {} SENT to={}", label, toAddress);
        } catch (RuntimeException e) {
            log.error("[email] {} FAILED to={}: {}", label, toAddress, e.toString());
        }
    }

    private static String projectUrlFor(ProjectKind kind, UUID id) {
        // Hardcoded prod URLs — APK projects open in openapk.ai, BIN projects
        // in app.openbin.ai. If we ever ship staging/preview environments
        // these become a config property; for now hardcoding is fine.
        if (kind == ProjectKind.BIN) {
            return "https://app.openbin.ai/projects/" + id;
        }
        return "https://openapk.ai/projects/" + id;
    }

    private boolean isConfigured() {
        return cfg != null
                && cfg.region() != null && !cfg.region().isBlank()
                && cfg.abuseFrom() != null && !cfg.abuseFrom().isBlank()
                && cfg.abuseTo() != null && !cfg.abuseTo().isBlank();
    }

    private SesV2Client sesClient() {
        // Double-checked locking — only build the client the first time
        // we actually need it. Avoids paying SDK startup cost during boot
        // when SES is never used in dev.
        SesV2Client c = client;
        if (c == null) {
            synchronized (this) {
                c = client;
                if (c == null) {
                    c = SesV2Client.builder().region(Region.of(cfg.region())).build();
                    client = c;
                }
            }
        }
        return c;
    }

    private static String safe(String s, int max) {
        if (s == null) return "";
        String t = s.replace("\r", "").trim();
        return t.length() <= max ? t : t.substring(0, max) + "…";
    }

    private static String truncate(String s, int max) {
        if (s == null) return "";
        return s.length() <= max ? s : s.substring(0, max) + "…";
    }
}
