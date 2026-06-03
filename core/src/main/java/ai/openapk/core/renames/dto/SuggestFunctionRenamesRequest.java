package ai.openapk.core.renames.dto;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;

import java.util.UUID;

/**
 * BIN-only request body. {@code functionName} is the name as the user sees
 * it in the UI (so it may be a previously-applied rename); the service
 * inverse-resolves through {@code RenameService.resolveOriginal} before
 * locating the function body in the analysis JSON.
 */
public record SuggestFunctionRenamesRequest(
        @NotBlank String functionName,
        @NotNull UUID credentialId,
        String model
) {}
