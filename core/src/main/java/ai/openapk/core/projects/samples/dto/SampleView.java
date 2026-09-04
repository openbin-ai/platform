package ai.openapk.core.projects.samples.dto;

import ai.openapk.core.projects.samples.ProjectSample;
import ai.openapk.core.projects.samples.ProjectSampleStatus;

import java.time.Instant;
import java.util.UUID;
import java.util.function.Function;

/**
 * One attached sample as the frontend sees it. {@code analysisDownloadUrl} is
 * the short-TTL CloudFront signed URL for the raw worker JSON — same contract
 * as {@link ai.openapk.core.projects.dto.ProjectResponse#analysisDownloadUrl()};
 * null when the sample isn't READY or CDN signing isn't configured (the
 * frontend then falls back to the inline {@code /samples/{sid}/binary-analysis}
 * endpoint).
 */
public record SampleView(
        UUID id,
        String label,
        String originalFilename,
        String sha256,
        long sizeBytes,
        String arch,
        String executableFormat,
        String compiler,
        String languageId,
        String imageBase,
        ProjectSampleStatus status,
        String errorMessage,
        Instant createdAt,
        Instant analyzedAt,
        String analysisDownloadUrl,
        long analysisSizeBytes
) {
    public static SampleView from(ProjectSample s, Function<String, String> urlSigner) {
        String signed = null;
        if (urlSigner != null && s.getStatus() == ProjectSampleStatus.READY
                && s.getAnalysisS3Key() != null && !s.getAnalysisS3Key().isBlank()) {
            signed = urlSigner.apply(s.getAnalysisS3Key());
        }
        return new SampleView(
                s.getId(),
                s.getLabel(),
                s.getOriginalFilename(),
                s.getSha256(),
                s.getSizeBytes(),
                s.getArch(),
                s.getExecutableFormat(),
                s.getCompiler(),
                s.getLanguageId(),
                s.getImageBase(),
                s.getStatus(),
                s.getErrorMessage(),
                s.getCreatedAt(),
                s.getAnalyzedAt(),
                signed,
                s.getAnalysisSizeBytes() != null ? s.getAnalysisSizeBytes() : 0L
        );
    }
}
