package ai.openapk.core.script.dto;

import java.time.Instant;

/**
 * A previously-saved on-demand deobfuscation, replayed to the code viewer
 * when a SCRIPT project is opened. Shapes deliberately match the live
 * {@link DeobfuscateResponse} fields the UI renders, so restoring a saved
 * result and running a fresh one hit the same rendering path.
 */
public record SavedDeobfuscation(
        String filePath,
        /** Engine the analyst asked for (auto | obfuscator-io | generic | caesar). */
        String engine,
        /** Engine auto settled on; equals {@code engine} for explicit runs. */
        String engineUsed,
        String source,
        String note,
        Double score,
        Double baselineScore,
        boolean truncated,
        Instant savedAt
) {}
