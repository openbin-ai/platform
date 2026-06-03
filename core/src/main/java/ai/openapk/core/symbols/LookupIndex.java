package ai.openapk.core.symbols;

import ai.openapk.core.symbols.dto.Symbol;
import ai.openapk.core.symbols.dto.SymbolIndex;
import ai.openapk.core.symbols.dto.SymbolKind;

import java.util.ArrayList;
import java.util.Collections;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.TreeMap;

/**
 * Precomputed lookup tables built from a {@link SymbolIndex}. Replaces the
 * O(N) linear scans that {@link SymbolService} and the call-chain builder
 * used to do per query — turns each lookup into a single hashmap fetch.
 *
 * <p>For a WhatsApp-sized index (~1M symbols), this struct adds ~50-200 ms of
 * map-building cost at construction time but pays for itself within ~3-5
 * lookups. The call-chain builder issues dozens of lookups per request, so
 * net it's a big win.
 *
 * <p>Build once per request (e.g. at the top of {@code CallChainService.build}),
 * pass through recursion. Not thread-safe; not intended to be cached across
 * requests since the underlying index can be rebuilt at any time.
 */
public final class LookupIndex {

    private final SymbolIndex source;
    /** name → all symbols with that name (across files / kinds). */
    private final Map<String, List<Symbol>> byName;
    /** file → (start-line → method/ctor symbol), sorted, for floorEntry lookups. */
    private final Map<String, TreeMap<Integer, Symbol>> methodsByFile;

    public LookupIndex(SymbolIndex source) {
        this.source = source;
        this.byName = new HashMap<>();
        this.methodsByFile = new HashMap<>();
        for (Symbol s : source.symbols()) {
            byName.computeIfAbsent(s.name(), k -> new ArrayList<>()).add(s);
            if (s.kind() == SymbolKind.METHOD || s.kind() == SymbolKind.CONSTRUCTOR) {
                methodsByFile
                        .computeIfAbsent(s.file(), k -> new TreeMap<>())
                        .put(s.line(), s);
            }
        }
    }

    public SymbolIndex source() {
        return source;
    }

    /** All symbols with this exact name. Empty list if none — never null. */
    public List<Symbol> byName(String name) {
        return byName.getOrDefault(name, Collections.emptyList());
    }

    /**
     * Method (or constructor) whose body encloses {@code file:line}, or null
     * if none is indexed in that file. Approximate: returns the latest method
     * starting at or before the given line. Caller may still want to verify
     * the line falls before the method's closing brace (the body-end check
     * lives in CallChainService since it needs disk access).
     */
    public Symbol enclosingMethod(String file, int line) {
        TreeMap<Integer, Symbol> sorted = methodsByFile.get(file);
        if (sorted == null) return null;
        Map.Entry<Integer, Symbol> floor = sorted.floorEntry(line);
        return floor == null ? null : floor.getValue();
    }

    /** Total symbols across all kinds — used by callers for "X of Y" hints. */
    public int size() {
        return source.symbols().size();
    }
}
