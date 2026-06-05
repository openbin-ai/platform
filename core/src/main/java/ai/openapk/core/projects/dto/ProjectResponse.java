package ai.openapk.core.projects.dto;

import ai.openapk.core.analysis.AnalysisMode;
import ai.openapk.core.projects.Project;
import ai.openapk.core.projects.ProjectKind;
import ai.openapk.core.projects.ProjectStatus;
import ai.openapk.core.projects.WorkflowStatus;

import java.time.Instant;
import java.util.UUID;
import java.util.function.Function;

public record ProjectResponse(
        UUID id,
        ProjectKind kind,
        String name,
        String originalFilename,
        long sizeBytes,
        String sha256,
        ProjectStatus status,
        WorkflowStatus workflowStatus,
        AnalysisMode analysisMode,
        String errorMessage,
        // APK-only: null for BIN projects.
        String packageName,
        // BIN-only: null for APK projects, and null for BIN until analysis lands.
        String arch,
        String executableFormat,
        String compiler,
        String languageId,
        String imageBase,
        Instant createdAt,
        Instant decompiledAt,
        String decompilePhase,
        Instant decompileStartedAt,
        // BIN-only schema-2.0: short-TTL CloudFront signed URL the frontend
        // fetches the worker JSON from. Null when (a) the project is APK,
        // (b) the project still uses inline JSONB (legacy), or (c) CDN
        // signing isn't configured. Frontend treats null as "fall back to
        // inline reads via the existing project detail endpoint".
        String analysisDownloadUrl,
        long analysisSizeBytes
) {
    /**
     * Convenience variant that omits the signed URL. Used by code paths
     * that don't yet have the CloudFront signer at hand (legacy ingest,
     * tests). Equivalent to {@code from(p, key -> null)}.
     */
    public static ProjectResponse from(Project p) {
        return from(p, null);
    }

    /**
     * Build a response with an optional URL signer. When {@code urlSigner}
     * is non-null AND the project has an S3 key set, the URL is minted
     * and embedded in the response. Otherwise {@code analysisDownloadUrl}
     * is null and the frontend falls back to the legacy inline read.
     */
    public static ProjectResponse from(Project p, Function<String, String> urlSigner) {
        String signedUrl = null;
        String s3Key = p.getBinaryAnalysisS3Key();
        if (urlSigner != null && s3Key != null && !s3Key.isBlank()) {
            signedUrl = urlSigner.apply(s3Key);
        }
        long size = p.getBinaryAnalysisSizeBytes() != null ? p.getBinaryAnalysisSizeBytes() : 0L;
        return new ProjectResponse(
                p.getId(),
                p.getKind(),
                p.getName(),
                p.getOriginalFilename(),
                p.getSizeBytes(),
                p.getSha256(),
                p.getStatus(),
                p.getWorkflowStatus(),
                p.getAnalysisMode(),
                p.getErrorMessage(),
                p.getPackageName(),
                p.getArch(),
                p.getExecutableFormat(),
                p.getCompiler(),
                p.getLanguageId(),
                p.getImageBase(),
                p.getCreatedAt(),
                p.getDecompiledAt(),
                p.getDecompilePhase(),
                p.getDecompileStartedAt(),
                signedUrl,
                size
        );
    }
}
