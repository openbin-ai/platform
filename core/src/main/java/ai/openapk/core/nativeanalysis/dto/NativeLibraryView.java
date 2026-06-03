package ai.openapk.core.nativeanalysis.dto;

import ai.openapk.core.nativeanalysis.NativeAnalysisStatus;

import java.time.Instant;

/**
 * One row in the {@code GET /libraries} response. Combines on-disk facts
 * (path, arch, size) with the persisted job status so the frontend can
 * render a single list and decide what to poll. {@code status} is null when
 * we've never kicked off an analysis for this lib.
 */
public record NativeLibraryView(
        String libPath,
        String arch,
        long sizeBytes,
        NativeAnalysisStatus status,
        String errorMessage,
        Instant analyzedAt
) {}
