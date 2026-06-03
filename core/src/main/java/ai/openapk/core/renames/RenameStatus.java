package ai.openapk.core.renames;

public enum RenameStatus {
    /** Proposed by AI, sitting in the review panel — not yet rewriting source. */
    SUGGESTED,
    /** Accepted by the user — rewriting source on every file read. */
    APPLIED
}
