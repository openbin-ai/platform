package ai.openapk.core.analysis.dto;

import jakarta.validation.Valid;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Size;

import java.util.List;
import java.util.UUID;

/**
 * {@code priorTurns} carries the existing chat thread so the model can answer
 * follow-ups. Optional; null or empty for a fresh ask.
 */
public record AskRequest(
        @NotBlank String filePath,
        @NotBlank @Size(max = 2000) String question,
        @NotNull UUID credentialId,
        String model,
        @Valid List<PriorTurn> priorTurns
) {
    public record PriorTurn(
            @NotBlank @Pattern(regexp = "user|assistant") String role,
            @NotBlank @Size(max = 50_000) String content
    ) {}
}
