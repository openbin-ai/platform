package ai.openapk.core.reports.dto;

import java.util.UUID;

/**
 * One entry in a report's contributor byline. {@code credit} is LEAD (the
 * project owner who published) or CONTRIBUTOR. {@code userId} is null when the
 * credited account has since been deleted (the display name is snapshotted so
 * the credit still renders). {@code isBot} flags synthetic authors like BINNY
 * (always false until the bot account lands in Phase B).
 */
public record Contributor(
        UUID userId,
        String displayName,
        String emailMd5,
        String credit,
        boolean isBot
) {}
