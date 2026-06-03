package ai.openapk.core.crypto.dto;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;

import java.util.UUID;

/**
 * BIN-only request body. {@code functionName} is the name as the user sees
 * it in the UI (may be a previously-applied rename); the service inverse-
 * resolves through {@code RenameService.resolveOriginal} before locating
 * the function body in the analysis JSON.
 */
public record GenerateBinDecryptorRequest(
        @NotBlank String functionName,
        @NotNull UUID credentialId,
        String model
) {}
