package ai.openapk.core.script.dto;

// Jackson 3 moved databind to tools.jackson.*, but the ANNOTATIONS artifact
// kept its original com.fasterxml.jackson.annotation package — matching
// ScriptAnalysisFindings next door.
import com.fasterxml.jackson.annotation.JsonIgnoreProperties;

import java.util.List;

/**
 * Worker result for an on-demand deobfuscation. Mirrors the JSON returned
 * by script-worker's {@code op: 'deobfuscate'} handler.
 *
 * <p>{@code attempts} is the per-engine breakdown — in auto mode the UI
 * shows it so the analyst can see what else was tried and why it lost,
 * rather than being told to trust an opaque pick.
 *
 * <p>Unknown properties are ignored so the worker can add diagnostic
 * fields without requiring a lockstep core deploy.
 */
@JsonIgnoreProperties(ignoreUnknown = true)
public record DeobfuscateResponse(
        String engine,
        boolean used,
        String source,
        String note,
        String error,
        Double score,
        Double baselineScore,
        Boolean looksObfuscated,
        boolean truncated,
        Integer durationMs,
        List<Attempt> attempts
) {
    @JsonIgnoreProperties(ignoreUnknown = true)
    public record Attempt(
            String engine,
            boolean used,
            Double score,
            Integer durationMs,
            String error
    ) {}
}
