package ai.openapk.core.social.dto;

/**
 * Response from follow/unfollow and upvote/unvote toggle endpoints.
 * {@code active} reflects the new state (true after a follow, false
 * after an unfollow); {@code count} is the new aggregate so the caller
 * can update the badge without a follow-up GET.
 */
public record ToggleResponse(boolean active, long count) {}
