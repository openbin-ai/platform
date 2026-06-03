package ai.openapk.core.renames.dto;

import java.util.List;

/**
 * Result of running the AI rename pass. `suggestions` are the rows newly added
 * (or refreshed) for SUGGESTED status; the frontend uses this for the review
 * panel. `chunks`/`inputTokens`/`outputTokens` are cost transparency for the user.
 */
public record SuggestRenamesResponse(
        List<RenameDto> suggestions,
        int chunks,
        int inputTokens,
        int outputTokens,
        String model
) {}
