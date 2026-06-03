package ai.openapk.core.symbols.dto;

/** A live-grepped reference (callsite, field read, etc.) to a named identifier. */
public record SymbolUsage(
        String file,
        int line,
        String snippet
) {}
