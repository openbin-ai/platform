package ai.openapk.core.analysis.agent.dto;

import jakarta.validation.Valid;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Size;

import java.util.List;
import java.util.UUID;

/**
 * One BINNY light turn. Exactly one of {@code functionName} (BIN) or
 * {@code filePath} (APK / SCRIPT) names what the user is looking at; SCRIPT
 * projects also send {@code fileContent}, because their bundles are read
 * in the browser, not on the server. {@code priorTurns} is the visible
 * thread, replayed as text (the UI keeps threads in localStorage).
 */
public record BinnyRequest(
        @Size(max = 512) String functionName,
        @Size(max = 1024) String filePath,
        @Size(max = 120_000) String fileContent,
        @NotBlank @Size(max = 4000) String question,
        UUID credentialId,
        @Size(max = 200) String model,
        @Valid @Size(max = 60) List<PriorTurn> priorTurns
) {
    public record PriorTurn(
            @NotBlank @Pattern(regexp = "user|assistant") String role,
            @NotBlank @Size(max = 16_000) String content
    ) {}
}
