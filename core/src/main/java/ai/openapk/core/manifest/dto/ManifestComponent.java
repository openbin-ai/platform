package ai.openapk.core.manifest.dto;

import java.util.List;

/**
 * One Android component declared in AndroidManifest.xml.
 * {@code exported} is the effective value (explicit attribute, falling back
 * to {@code intentFilters.isEmpty() ? false : true}). {@code file} + {@code line}
 * are cross-referenced from the symbol index when the class is found in the
 * decompiled tree.
 */
public record ManifestComponent(
        String kind,                  // "activity" | "service" | "receiver" | "provider" | "application"
        String className,             // fully qualified, with relative names expanded against the manifest's package
        boolean exported,
        boolean enabled,
        String permission,            // android:permission attribute, "" if absent
        List<IntentFilter> intentFilters,
        List<String> authorities,     // for providers
        String file,                  // null if class not found in index
        Integer line                  // null if class not found
) {}
