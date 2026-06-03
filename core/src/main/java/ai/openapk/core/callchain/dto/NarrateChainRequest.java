package ai.openapk.core.callchain.dto;

import jakarta.validation.constraints.NotNull;

import java.util.UUID;

public record NarrateChainRequest(
        @NotNull CallChain chain,
        @NotNull UUID credentialId,
        String model
) {}
