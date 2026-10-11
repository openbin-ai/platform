package ai.openapk.core.dm.dto;

import ai.openapk.core.dm.DmPolicy;
import jakarta.validation.constraints.NotNull;

public record UpdateDmSettingsRequest(@NotNull DmPolicy policy) {}
