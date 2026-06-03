package ai.openapk.core.analysis.dto;

import java.util.List;
import java.util.Map;

public record StaticDigest(
        String packageName,
        Integer minSdk,
        Integer targetSdk,
        Boolean debuggable,
        Boolean usesCleartextTraffic,
        List<Permission> permissions,
        List<Component> components,
        Map<String, List<SignatureHit>> signatures,
        List<Ioc> iocs,
        int codeFileCount,
        int totalFileCount
) {
    public record Permission(String name, boolean dangerous) {}

    public record Component(
            String type,
            String name,
            boolean exported,
            List<String> intentFilters,
            String permission
    ) {}
}
