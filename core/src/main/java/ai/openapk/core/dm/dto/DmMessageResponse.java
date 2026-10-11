package ai.openapk.core.dm.dto;

import java.time.Instant;
import java.util.UUID;

/**
 * One message. {@code mine} is personalized to the caller. {@code sender}
 * carries the name and avatar hash so a group thread can label bubbles;
 * a 1:1 thread can ignore it.
 */
public record DmMessageResponse(
        UUID id,
        UUID senderId,
        DmUser sender,
        String body,
        Instant createdAt,
        boolean mine
) {}
