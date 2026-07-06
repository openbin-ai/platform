package ai.openapk.core.highlights.dto;

import jakarta.validation.constraints.Size;

/**
 * Partial update of a highlight card. All fields optional — null means
 * "leave unchanged". {@code position} drives reordering on the board.
 */
public record UpdateHighlightRequest(
        @Size(max = 48) String tag,
        @Size(max = 4000) String note,
        Integer position
) {}
