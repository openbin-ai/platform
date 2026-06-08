package ai.openapk.core.script.dto;

import com.fasterxml.jackson.annotation.JsonIgnoreProperties;

import java.util.List;
import java.util.Map;

/**
 * Java mirror of the Lambda's findings.json (v1). Fields the JVM doesn't
 * care about (e.g. AST debug evidence) ride along as a free-form Map so
 * we stay forward-compatible with worker-side additions without a coupled
 * deploy. See {@code script-worker/README.md} for the canonical schema.
 */
@JsonIgnoreProperties(ignoreUnknown = true)
public record ScriptAnalysisFindings(
        int schemaVersion,
        String analyzedAt,
        Integer durationMs,
        Summary summary,
        List<Finding> findings
) {
    @JsonIgnoreProperties(ignoreUnknown = true)
    public record Summary(
            int fileCount,
            int tarballEntryCount,
            int findingCount,
            Map<String, Integer> countsBySeverity,
            Package pkg,
            int deobfuscatedFileCount,
            // "npm" or "pypi" — added in JS-2 when the pypi-worker landed.
            // Nullable: pre-JS-2 findings JSON has no field; treat as "npm".
            String ecosystem
    ) {
        // Jackson maps the JSON "package" → this field. Named "pkg" in
        // Java because "package" is a reserved word.
        @com.fasterxml.jackson.annotation.JsonProperty("package")
        public Package pkg() { return pkg; }
    }

    @JsonIgnoreProperties(ignoreUnknown = true)
    public record Package(
            boolean found,
            String name,
            String version,
            String description,
            Integer maintainerCount,
            Integer dependencyCount,
            Boolean hasInstallHook,
            List<InstallHook> installHooks,
            String parseError
    ) {}

    @JsonIgnoreProperties(ignoreUnknown = true)
    public record InstallHook(String key, String script) {}

    @JsonIgnoreProperties(ignoreUnknown = true)
    public record Finding(
            String id,
            String rule,
            String severity,
            String file,
            int line,
            int column,
            String message,
            String snippet,
            String remediation,
            Map<String, Object> evidence,
            boolean deobfuscated
    ) {}
}
