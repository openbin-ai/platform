package ai.openapk.core.notifications.dto;

/**
 * PATCH body for /api/me/email-preferences. Each field is nullable so the
 * frontend can send only the toggle the user just flipped without having to
 * re-state the others — a missing field means "keep the existing value".
 */
public record UpdateEmailPrefsRequest(
        Boolean notifyDecompileComplete,
        Boolean notifyReportPublished,
        Boolean notifyAbuseConfirmation
) {}
