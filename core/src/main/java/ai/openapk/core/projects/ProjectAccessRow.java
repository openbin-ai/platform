package ai.openapk.core.projects;

/**
 * Spring Data interface-based projection returned by
 * {@link ProjectRepository#findAccessibleByIdAndUserId} and
 * {@link ProjectRepository#findAllAccessibleByUserId}. Pairs the
 * project entity with the caller's effective role on it.
 *
 * <p>{@link #getRole()} returns the raw enum name ({@code "OWNER"},
 * {@code "EDITOR"}, or {@code "VIEWER"}) so the JPQL CASE expression
 * can mix the synthetic {@code 'OWNER'} literal with the
 * {@code ProjectCollaborator.role} column value. Callers convert via
 * {@link ProjectRole#valueOf(String)}.
 */
public interface ProjectAccessRow {
    Project getProject();
    String getRole();
}
