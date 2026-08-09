package ai.openapk.core.renames.dto;

import jakarta.validation.constraints.AssertTrue;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;

/**
 * Body for {@code POST /renames/manual} — user-driven rename, applied
 * immediately (no SUGGESTED middle state). Same row shape as a
 * suggest+apply flow result, just upserted in one shot. No LLM credential
 * is involved: this is the rename path for analysts who know what the
 * symbol is and don't want to spend a model call to be told.
 *
 * <p>{@code scope} is informational for most values (e.g. "function" for
 * BIN, "method"/"class" for APK) and doesn't constrain what gets
 * substituted — with ONE exception. {@code scope = "variable"} is applied
 * only inside its owning function body, because decompilers reuse names
 * like {@code uVar1} across every function they emit; renaming those
 * project-wide would corrupt unrelated code. Variable renames therefore
 * require {@code functionName}.
 */
public record ManualRenameRequest(
        @NotBlank @Size(max = 500) String original,
        @NotBlank @Size(max = 500) String suggested,
        @NotBlank @Size(max = 40)  String scope,
        /**
         * The container this rename belongs to, so the same identifier can
         * be renamed independently in different places:
         *
         * <ul>
         *   <li>{@code scope = "variable"} (BIN) — the owning function name.
         *       Required; stored as {@code source_path = "function:<name>"},
         *       matching what the AI suggest path writes, which is what the
         *       BIN applier keys off when rewriting only that function's
         *       body.</li>
         *   <li>Any other scope — an optional file path, stored verbatim.
         *       SCRIPT projects use this: a symbol in {@code lib/a.js} must
         *       not be rewritten inside {@code lib/b.js}.</li>
         * </ul>
         *
         * Omit for project-wide renames (function/class/method names).
         */
        @Size(max = 450) String scopeRef
) {
    @AssertTrue(message = "scopeRef (the owning function) is required when scope is \"variable\"")
    public boolean isVariableScoped() {
        return !"variable".equals(scope) || (scopeRef != null && !scopeRef.isBlank());
    }

    /** The {@code source_path} tag this rename should be stored under, or null. */
    public String sourcePathTag() {
        if (scopeRef == null || scopeRef.isBlank()) return null;
        return "variable".equals(scope) ? "function:" + scopeRef : scopeRef;
    }
}
