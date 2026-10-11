package ai.openapk.core.dm.dto;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;

public record SendDmRequest(
        @NotBlank @Size(max = 4000) String body
) {}
