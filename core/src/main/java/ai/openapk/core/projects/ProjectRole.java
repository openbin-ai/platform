package ai.openapk.core.projects;

/**
 * Tier of access a user holds on a project. {@code OWNER} is implicit
 * (whoever {@code projects.user_id} points at) and is never stored on
 * {@link ProjectCollaborator} — keeping it off the table means there's
 * exactly one source of truth for project ownership.
 *
 * <p>Tier semantics:
 * <ul>
 *   <li>{@code OWNER}  — full control: delete, change permissions,
 *       publish to community feed.</li>
 *   <li>{@code EDITOR} — can read everything and mutate analyses,
 *       renames, deobfuscations, reports, native re-ingest. Cannot
 *       delete the project or change collaborator roster.</li>
 *   <li>{@code VIEWER} — read-only across the project surface. Lazy
 *       caches that need a row write (symbol index, JNI bridge cache)
 *       are still allowed — the cache belongs to the project, not the
 *       caller — but no user-driven mutations.</li>
 * </ul>
 */
public enum ProjectRole {
    OWNER,
    EDITOR,
    VIEWER;

    /** True when this role is allowed to perform edit-level mutations. */
    public boolean canEdit() {
        return this == OWNER || this == EDITOR;
    }

    /** True when this role is the project owner. */
    public boolean isOwner() {
        return this == OWNER;
    }
}
