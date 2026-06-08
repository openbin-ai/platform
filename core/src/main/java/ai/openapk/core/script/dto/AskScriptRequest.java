package ai.openapk.core.script.dto;

import ai.openapk.core.analysis.dto.AskRequest;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;

import java.util.List;
import java.util.UUID;

/**
 * Q&A request for a SCRIPT project. The browser sends the file content
 * directly from its cached bundle — saves a server-side S3 round-trip
 * for every chat turn. {@code deobfuscated} tells the server whether
 * the content came from the original or deobfuscated tab so the system
 * prompt can frame it correctly.
 */
public record AskScriptRequest(
        @NotBlank String filePath,
        // Capped at 60 KB to match the APK ASK_MAX_FILE_BYTES; larger files
        // are pre-truncated on the client.
        @NotNull @Size(max = 60 * 1024) String fileContent,
        boolean deobfuscated,
        @NotBlank @Size(max = 4000) String question,
        @NotNull UUID credentialId,
        String model,
        List<AskRequest.PriorTurn> priorTurns
) {
}
