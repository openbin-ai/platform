package ai.openapk.core.symbols.dto;

import java.time.Instant;
import java.util.List;

/** Serialized form persisted in projects.symbol_index_jsonb. */
public record SymbolIndex(
        Instant builtAt,
        int fileCount,
        List<Symbol> symbols
) {}
