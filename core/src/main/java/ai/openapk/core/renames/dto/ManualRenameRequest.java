package ai.openapk.core.renames.dto;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;

/**
 * Body for {@code POST /renames/manual} — user-driven rename, applied
 * immediately (no SUGGESTED middle state). Same row shape as a suggest+apply
 * flow result, just upserted in one shot.
 *
 * <p>{@code scope} is informational (e.g. "function" for BIN, "method"/"class"
 * for APK); it doesn't constrain what gets substituted.
 */
public record ManualRenameRequest(
        @NotBlank @Size(max = 500) String original,
        @NotBlank @Size(max = 500) String suggested,
        @NotBlank @Size(max = 40)  String scope
) {}
