package ai.openapk.core.script.dto;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Size;

/**
 * On-demand deobfuscation of a single file in a SCRIPT project.
 *
 * <p>Only the path is sent — the worker reads the bytes out of the
 * project's analysis bundle in S3. That keeps the request small no matter
 * how large the file is, and means a caller can't hand the worker
 * arbitrary text to burn CPU on.
 *
 * <p>{@code engine} is {@code auto} (run the plausible engines and keep
 * the best-scoring result) or an explicit engine id. The whitelist is
 * enforced here as well as in the worker so a bad value fails fast with a
 * 400 instead of a 502 from the Lambda.
 */
public record DeobfuscateRequest(
        @NotBlank @Size(max = 512) String filePath,
        @Pattern(regexp = "auto|obfuscator-io|generic|caesar",
                 message = "engine must be one of: auto, obfuscator-io, generic, caesar")
        String engine
) {
    /** Null-safe accessor — an absent engine means auto. */
    public String engineOrAuto() {
        return engine == null || engine.isBlank() ? "auto" : engine;
    }
}
