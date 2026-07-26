package ai.openapk.core.bundles.dto;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;

/**
 * Create-or-get a bundle by name. The CLI posts this before ingesting the
 * files of a sweep / --bundle run so it can tag each initiate with the bundle
 * id. Get-or-create semantics keep re-runs of the same command idempotent
 * (they append to the existing bundle instead of spawning duplicates).
 */
public record CreateBundleRequest(
        @NotBlank @Size(max = 200) String name
) {}
