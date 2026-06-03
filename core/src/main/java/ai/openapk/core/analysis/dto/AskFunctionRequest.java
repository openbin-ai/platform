package ai.openapk.core.analysis.dto;

import jakarta.validation.Valid;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Size;

import java.util.List;
import java.util.UUID;

/**
 * Body for BIN-only function-level Q&A. {@code functionName} matches a
 * {@code functions[].name} entry from the worker's extract output (the
 * server inverse-resolves through {@code RenameService} so user-renamed
 * names also work).
 *
 * <p>{@code priorTurns} is the existing conversation thread for this
 * function — the frontend tracks history in component state and replays it
 * on each send so the model can answer "what about line 5?" type follow-ups.
 * Null/empty for a fresh ask.
 */
public record AskFunctionRequest(
        @NotBlank String functionName,
        @NotBlank @Size(max = 2000) String question,
        @NotNull UUID credentialId,
        String model,
        @Valid List<PriorTurn> priorTurns
) {
    /** One side of a prior turn in the thread. Role is "user" or "assistant"
     *  to match the OpenAI/Anthropic convention. */
    public record PriorTurn(
            @NotBlank @Pattern(regexp = "user|assistant") String role,
            @NotBlank @Size(max = 16000) String content
    ) {}
}
