package ai.openapk.core.projects.dto;

import ai.openapk.core.analysis.AnalysisMode;
import ai.openapk.core.projects.Project;
import ai.openapk.core.projects.ProjectKind;
import ai.openapk.core.projects.ProjectRole;
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
        long analysisSizeBytes,
        // Caller's effective role on the project. OWNER for the project's
        // creator, EDITOR / VIEWER for collaborators. Null when the
        // response is built outside an authenticated request context
        // (e.g. internal worker code paths) — frontend treats null as
        // "assume owner" for back-compat with pre-collab clients.
        ProjectRole role,
        // Non-null = the project is publicly readable at /api/public/projects/{id}
        // as of this instant (owner-controlled). Null = private. Lets the owner
        // UI reflect the toggle state; anonymous public reads never populate a
        // signed analysisDownloadUrl (that path passes a null signer).
        Instant publicReadAt,
        // Source project id when this is a fork (null otherwise) — drives the
        // "forked from" attribution link. forkCount = direct forks of this one.
        UUID forkedFromId,
        int forkCount,
        // Non-null = this project is a member of a multi-binary bundle. Drives
        // the projects-list grouping (members hidden from the top level) and
        // the ProjectView sibling tab bar (only rendered when this is set).
        UUID bundleId
) {
    /**
     * Convenience variant for code paths that don't have a URL signer or
     * caller role at hand (legacy ingest, async worker callbacks, tests).
     * The frontend treats a null role as "assume owner" for back-compat
     * with pre-collab clients.
     */
    public static ProjectResponse from(Project p) {
        return from(p, null, null);
    }

    /**
     * Variant with URL signer but no caller role. Used by code paths that
     * upload / create a new project (where the caller IS the owner by
     * definition) — pass null role and the frontend uses its back-compat
     * fallback.
     */
    public static ProjectResponse from(Project p, Function<String, String> urlSigner) {
        return from(p, urlSigner, null);
    }

    /**
     * Full variant. {@code role} is the caller's effective access tier
     * on this project, resolved through {@link ai.openapk.core.projects.ProjectAccessGuard}.
     * When {@code urlSigner} is non-null AND the project has an S3 key,
     * the CloudFront signed URL is embedded; otherwise the frontend falls
     * back to the legacy inline read.
     */
    public static ProjectResponse from(Project p, Function<String, String> urlSigner, ProjectRole role) {
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
                size,
                role,
                p.getPublicReadAt(),
                p.getForkedFrom() != null ? p.getForkedFrom().getId() : null,
                p.getForkCount(),
                p.getBundle() != null ? p.getBundle().getId() : null
        );
    }
}
