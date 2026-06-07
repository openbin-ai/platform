package ai.openapk.core.notifications.dto;

/** Bell-badge value. Polled every ~30s by the frontend. */
public record UnreadCountResponse(long unread) {}
