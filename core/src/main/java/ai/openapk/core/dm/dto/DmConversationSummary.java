package ai.openapk.core.dm.dto;

import java.time.Instant;
import java.util.UUID;

/**
 * One inbox row. {@code unread} is the caller's unread message count in
 * this conversation; {@code lastMessageMine} lets the row render "You: …".
 *
 * <p>Two shapes: a 1:1 DM has {@code other} set and no project; a project
 * team chat has {@code projectId}, {@code projectName} and {@code memberCount}
 * set and {@code other} null.
 */
public record DmConversationSummary(
        UUID id,
        DmUser other,
        UUID projectId,
        String projectName,
        int memberCount,
        Instant lastMessageAt,
        String lastMessagePreview,
        boolean lastMessageMine,
        long unread
) {}
