package ai.openapk.core.analysis.dto;

import java.util.List;

/**
 * Binary-side analog of {@link StaticDigest}. Sent to the LLM as the
 * high-signal summary of a BIN project so the model has enough context to
 * point an analyst at the right functions without seeing every instruction.
 *
 * <p>Where StaticDigest revolves around manifest/permissions/components, this
 * one revolves around imports, strings, and a few coarse behavior flags
 * derived from import categorization. Hotspot output from the LLM still uses
 * {@link Hotspot} — for BIN projects the {@code path} field carries a
 * function name (matching {@code functions[].name} in the worker output)
 * rather than a file path.
 */
public record BinaryDigest(
        String arch,
        String executableFormat,
        String compiler,
        String languageId,
        String imageBase,
        int functionCount,
        int stringCount,
        int importCount,
        List<SuspiciousImport> suspiciousImports,
        List<String> suspiciousStrings,
        List<Ioc> iocs,
        Hints hints,
        List<TopFunction> topFunctions
) {
    /** An import the digest pre-categorized as worth the LLM's attention. */
    public record SuspiciousImport(String name, String category) {}

    /** Coarse behavior flags derived from the categorized imports. */
    public record Hints(
            boolean antiDebug,
            boolean crypto,
            boolean networking,
            boolean dynamicLoading,
            boolean execShell,
            boolean memoryInjection
    ) {}

    /** A pointer to one of the binary's largest concrete functions — likely
     *  where the meaningful logic lives, vs the long tail of tiny utility
     *  functions and stubs. */
    public record TopFunction(String name, String address, int size) {}
}
