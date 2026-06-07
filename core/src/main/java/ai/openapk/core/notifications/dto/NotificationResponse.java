package ai.openapk.core.notifications.dto;

import java.time.Instant;
import java.util.Map;
import java.util.UUID;

/**
 * Wire shape for one bell-dropdown row. The frontend renders the row
 * generically from {@code kind} + {@code payload} — every payload
 * carries {@code actorDisplayName} + {@code actorEmailMd5} for the
 * avatar/label, plus kind-specific extras.
 */
public record NotificationResponse(
        UUID id,
        String kind,
        Map<String, Object> payload,
        String link,
        boolean read,
        Instant createdAt
) {}
