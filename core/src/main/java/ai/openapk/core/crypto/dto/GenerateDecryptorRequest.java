package ai.openapk.core.crypto.dto;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Positive;

import java.util.UUID;

public record GenerateDecryptorRequest(
        @NotBlank String file,
        @Positive int line,
        UUID credentialId,
        String model
) {}
