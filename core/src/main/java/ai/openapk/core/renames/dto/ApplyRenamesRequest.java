package ai.openapk.core.renames.dto;

import jakarta.validation.constraints.NotEmpty;

import java.util.List;

/** Body for POST /renames/apply — flips these originals from SUGGESTED to APPLIED. */
public record ApplyRenamesRequest(@NotEmpty List<String> originals) {}
