package ai.openapk.core.projects.ingest.dto;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.PositiveOrZero;
import tools.jackson.databind.JsonNode;

/**
 * Wire shape posted by the OpenAPK CLI to {@code POST /api/projects/ingest}.
 *
 * <p>The CLI runs the Ghidra worker locally and forwards the raw worker JSON
 * here under {@code workerOutput}. This endpoint never invokes the cloud
 * worker — it just persists the result as a BIN project in READY state.
 *
 * <p>{@code schemaVersion} pins the JSON shape contract. The backend rejects
 * mismatched versions with 400 + "please upgrade your CLI" rather than
 * trying to guess at a backward-compatible parse — the worker output schema
 * is too large and field-y to safely tolerate drift.
 */
public record IngestRequest(
        @NotBlank String name,
        @NotBlank String originalFilename,
        String archHint,
        @PositiveOrZero long sizeBytes,
        @NotBlank String sha256,
        @NotBlank String schemaVersion,
        String source,
        @NotNull JsonNode workerOutput
) {}
