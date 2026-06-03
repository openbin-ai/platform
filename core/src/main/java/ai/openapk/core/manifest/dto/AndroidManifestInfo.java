package ai.openapk.core.manifest.dto;

import java.util.List;

public record AndroidManifestInfo(
        String packageName,
        Integer versionCode,
        String versionName,
        Integer minSdk,
        Integer targetSdk,
        List<String> permissions,           // <uses-permission>
        List<String> definedPermissions,    // <permission>
        ManifestComponent application,      // <application> itself (kind = "application"), or null
        List<ManifestComponent> activities,
        List<ManifestComponent> services,
        List<ManifestComponent> receivers,
        List<ManifestComponent> providers
) {}
