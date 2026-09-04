package ai.openapk.core.projects.samples.dto;

import java.util.Map;

/** Presigned-PUT handle for the CLI, mirroring the native ingest response shape. */
public record InitiateSampleIngestResponse(
        String sampleId,
        String uploadUrl,
        String s3Key,
        long expiresInSeconds,
        Map<String, String> requiredHeaders
) {}
