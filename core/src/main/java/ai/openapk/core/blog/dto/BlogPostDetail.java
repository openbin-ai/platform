package ai.openapk.core.blog.dto;

import java.time.Instant;
import java.util.UUID;

/** Full post read. {@code bodyMd} is raw markdown; the client renders it. */
public record BlogPostDetail(
        UUID id,
        String slug,
        String title,
        String summary,
        String bodyMd,
        UUID authorId,
        String authorDisplayName,
        String authorEmailMd5,
        // Author's public links, so a reader can follow the writer off-platform
        // without a second round trip to the profile endpoint.
        String authorBio,
        String authorWebsiteUrl,
        String authorGithubUser,
        String authorXUser,
        String authorMastodonUrl,
        String authorLinkedinUrl,
        Instant createdAt,
        Instant updatedAt,
        Instant publishedAt,
        long upvotes,
        boolean upvotedByMe,
        boolean mine,
        boolean draft,
        int readingMinutes
) {}
