package ai.openapk.core.deobf.dto;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;

import java.util.UUID;

/**
 * BIN-only request body. {@code functionName} may be a renamed (post-
 * accept) name — service inverse-resolves via RenameService.resolveOriginal
 * before storage so rows stay keyed on the stable pre-rename name.
 */
public record DeobfuscateFunctionRequest(
        @NotBlank String functionName,
        @NotNull UUID credentialId,
        String model
) {}
