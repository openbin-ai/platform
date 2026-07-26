package ai.openapk.core.reports.dto;

import java.time.Instant;
import java.util.List;
import java.util.UUID;

/**
 * Anonymous /community single-report read. Includes the full sections so
 * the public viewer can render the report identically to the auth'd
 * editor (minus controls). Project metadata is summarized inline rather
 * than exposing the whole Project record — anonymous readers don't need
 * upload paths or LLM credential refs.
 */
public record CommunityReportDetail(
        UUID reportId,
        UUID projectId,
        String kind,
        String title,
        List<ReportSection> sections,
        String malwareType,
        List<String> tags,
        String projectName,
        String originalFilename,
        String sha256,
        Long sizeBytes,
        String executableFormat,
        String arch,
        String packageName,
        Instant communityPublishedAt,
        UUID authorId,
        String authorDisplayName,
        String authorEmailMd5,
        long voteCount,
        boolean votedByMe,
        boolean amFollowingAuthor,
        // Frozen contributor byline (LEAD first); empty for legacy reports.
        List<Contributor> contributors,
        // Non-null when the project is anonymously public-readable
        // (projects.public_read_at). Drives the report page's "View project &
        // fork" link. Null = project private → the report shows no code link.
        Instant projectPublicReadAt
) {}
