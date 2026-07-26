package ai.openapk.core.bundles.dto;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;

/** PATCH body for the web app's bundle rename. */
public record RenameBundleRequest(
        @NotBlank @Size(max = 200) String name
) {}
