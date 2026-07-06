package ai.openapk.core.highlights.dto;

import ai.openapk.core.highlights.HighlightType;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;

/**
 * Create a highlight. For FUNCTION/FILE a {@code targetRef} is required
 * (enforced service-side so the message is friendly); VISUAL may omit it.
 * {@code mediaKey} is an existing media filename (the client uploads the
 * screenshot first, then references it here).
 */
public record CreateHighlightRequest(
        @NotNull HighlightType type,
        @Size(max = 512) String targetRef,
        @Size(max = 256) String mediaKey,
        @Size(max = 48) String tag,
        @Size(max = 4000) String note
) {}
