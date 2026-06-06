package ai.openapk.core.nativeanalysis.dto;

import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Pattern;

/**
 * CLI → backend: "I'm about to run Ghidra on {@code libPath} from project
 * {@code id}; hand me a presigned S3 PUT URL." {@code uploadSizeBytes} is
 * the size of the (gzipped) worker JSON the CLI will upload, used to bind
 * the presigned URL's signature to a max body size.
 *
 * <p>{@code archHint} is informational only — the worker's metadata wins
 * when finalize parses the body. Schema version mirrors the BIN ingest
 * pipeline so we can evolve the shape without breaking older CLIs.
 */
public record InitiateNativeIngestRequest(
        @NotBlank String schemaVersion,
        @NotBlank @Pattern(regexp = "^resources/lib/[^/]+/[^/]+\\.so$",
                message = "libPath must be of the form resources/lib/<abi>/<name>.so")
        String libPath,
        @NotBlank @Pattern(regexp = "^[0-9a-fA-F]{64}$",
                message = "sha256 must be 64 hex characters")
        String sha256,
        @Min(0) long uploadSizeBytes,
        String archHint
) {}
