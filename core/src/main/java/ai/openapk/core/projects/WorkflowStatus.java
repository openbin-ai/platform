package ai.openapk.core.projects;

/**
 * Case-management state for a project. Distinct from {@link ProjectStatus}
 * which tracks the decompile pipeline. System auto-advances forward; users can
 * manually set anything except PUBLISHED (set by the report publish endpoint).
 * Enum order matters — {@link #advanceAtLeast} only moves forward.
 */
public enum WorkflowStatus {
    NEW,
    TRIAGING,
    ANALYZING,
    DRAFTING_REPORT,
    PUBLISHED;

    /** True if {@code target} is later in the workflow than {@code current} and current isn't PUBLISHED. */
    public static boolean shouldAdvance(WorkflowStatus current, WorkflowStatus target) {
        if (current == PUBLISHED) return false;
        return target.ordinal() > current.ordinal();
    }
}
