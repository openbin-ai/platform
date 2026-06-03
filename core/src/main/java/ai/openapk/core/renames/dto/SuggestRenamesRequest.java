package ai.openapk.core.renames.dto;

import jakarta.validation.constraints.NotBlank;

import java.util.UUID;

public record SuggestRenamesRequest(
        @NotBlank String filePath,
        UUID credentialId,
        String model
) {}
