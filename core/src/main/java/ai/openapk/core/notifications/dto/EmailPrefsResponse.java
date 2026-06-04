package ai.openapk.core.notifications.dto;

import ai.openapk.core.notifications.UserEmailPrefs;

/**
 * Wire shape returned by GET /api/me/email-preferences and PATCH responses.
 * Mirrors the boolean columns on {@link UserEmailPrefs} 1:1 so the frontend
 * can render checkboxes without further mapping.
 */
public record EmailPrefsResponse(
        boolean notifyDecompileComplete,
        boolean notifyReportPublished,
        boolean notifyAbuseConfirmation
) {
    public static EmailPrefsResponse from(UserEmailPrefs p) {
        if (p == null) return defaults();
        return new EmailPrefsResponse(
                p.isNotifyDecompileComplete(),
                p.isNotifyReportPublished(),
                p.isNotifyAbuseConfirmation()
        );
    }

    /** Defaults applied when no row exists yet for this user. */
    public static EmailPrefsResponse defaults() {
        return new EmailPrefsResponse(true, true, true);
    }
}
