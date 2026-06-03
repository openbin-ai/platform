package ai.openapk.core.callchain.dto;

import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Positive;

public record BuildChainRequest(
        @NotBlank String file,
        @Positive int line,
        @Min(1) int depth,
        boolean includeSdks
) {}
