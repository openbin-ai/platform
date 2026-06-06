package ai.openapk.core.nativeanalysis.dto;

import java.util.Map;

/**
 * Backend → CLI: presigned PUT URL + the headers S3 will require on the
 * request. Mirrors {@code InitiateIngestResponse} on the BIN side so the
 * CLI's upload helper can be reused.
 */
public record InitiateNativeIngestResponse(
        String nativeAnalysisId,
        String uploadUrl,
        String s3Key,
        long expiresInSeconds,
        Map<String, String> requiredHeaders
) {}
