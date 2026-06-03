package ai.openapk.core.symbols.dto;

/**
 * One declaration in the project's source. Coarse: regex-extracted, no full
 * AST resolution. {@code signature} is a raw snapshot of the params/type for
 * display (e.g. "(String s, byte[] key)" or "byte[]"). Empty for classes.
 */
public record Symbol(
        SymbolKind kind,
        String name,
        String className,    // owning class; same as name for CLASS/INTERFACE/ENUM
        String file,
        int line,
        String signature,    // params for METHOD, type for FIELD, "" otherwise
        String modifiers,    // raw modifier list (e.g. "public static")
        String pkg           // owning Java package (e.g. "defpackage", "" for unnamed)
) {}
