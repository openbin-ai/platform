package ai.openapk.core.manifest.dto;

import java.util.List;

public record IntentFilter(
        List<String> actions,
        List<String> categories,
        List<String> dataSchemes,
        Integer priority   // null when unspecified
) {}
