package ai.openapk.core.scripts.dto;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;

/** Save a script on a project. {@code language} is a free label (python, bash, js, cyberchef, ...). */
public record CreateScriptRequest(
        @NotBlank @Size(max = 200) String name,
        @NotBlank @Size(max = 32) String language,
        @Size(max = 2000) String description,
        @NotBlank @Size(max = 200_000) String content,
        @Size(max = 512) String sourceRef
) {}
