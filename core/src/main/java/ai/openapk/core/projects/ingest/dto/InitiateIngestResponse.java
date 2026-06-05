package ai.openapk.core.projects.ingest.dto;

import java.util.Map;

/**
 * Step 1 response. The CLI uses {@code uploadUrl} to PUT the gzipped
 * worker JSON to S3 with the headers listed in {@code requiredHeaders}
 * (those headers were part of the signed canonical request, so the
 * upload will be rejected if they aren't sent verbatim).
 *
 * <p>After the PUT succeeds the CLI calls
 * {@code POST /api/projects/ingest/finalize} with {@code projectId} to
 * confirm and trigger metadata extraction.
 */
public record InitiateIngestResponse(
        String projectId,
        String uploadUrl,
        String uploadKey,
        long expiresInSeconds,
        Map<String, String> requiredHeaders
) {}
