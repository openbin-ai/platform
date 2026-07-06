package ai.openapk.core.projects.dto;

import java.util.UUID;

/**
 * One public project matching a sha256 hash (GET /api/projects/dedup). The CLI
 * calls dedup before decompiling; on a hit it offers to fork an existing
 * public analysis instead of re-running the worker. PUBLIC projects only —
 * never leaks that a private sample with the same hash exists.
 *
 * {@code voteCount} is the community-report upvote total (0 if the project has
 * no published report), so the CLI can surface the most-trusted analysis first.
 */
public record DedupMatch(
        UUID projectId,
        String name,
        String ownerDisplayName,
        long voteCount
) {}
