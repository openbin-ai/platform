package ai.openapk.core.projects.dto;

import ai.openapk.core.analysis.AnalysisMode;
import ai.openapk.core.projects.Project;
import ai.openapk.core.projects.ProjectKind;
import ai.openapk.core.projects.ProjectStatus;
import ai.openapk.core.projects.WorkflowStatus;

import java.time.Instant;
import java.util.UUID;

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
        Instant decompileStartedAt
) {
    public static ProjectResponse from(Project p) {
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
                p.getDecompileStartedAt()
        );
    }
}
