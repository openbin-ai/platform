package ai.openapk.core.highlights.dto;

import jakarta.validation.constraints.Size;

/**
 * Partial update of a highlight card. All fields optional — null means
 * "leave unchanged", blank means "clear". {@code position} drives reordering
 * on the board. {@code mediaKey} adds/replaces the attached screenshot
 * (upload the image via the media endpoint first, then reference its
 * filename here — same flow as create).
 */
public record UpdateHighlightRequest(
        @Size(max = 48) String tag,
        @Size(max = 4000) String note,
        @Size(max = 256) String mediaKey,
        Integer position
) {}
