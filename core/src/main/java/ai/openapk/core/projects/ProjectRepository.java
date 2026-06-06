package ai.openapk.core.projects;

import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import java.util.List;
import java.util.Optional;
import java.util.UUID;

public interface ProjectRepository extends JpaRepository<Project, UUID> {

    List<Project> findAllByUserIdOrderByCreatedAtDesc(UUID userId);

    /**
     * @deprecated owner-only lookups bypass {@link ProjectCollaborator}.
     *     Route project access checks through {@link ProjectAccessGuard}
     *     so collaborators are recognized. Kept as a private API for the
     *     guard's own ownership query and for the migration window of
     *     services that haven't been flipped yet.
     */
    @Deprecated
    Optional<Project> findByIdAndUserId(UUID id, UUID userId);

    /**
     * Single-query access resolution used by {@link ProjectAccessGuard}:
     * returns the project + the caller's effective role (OWNER when
     * {@code projects.user_id} matches, otherwise the
     * {@code project_collaborators.role} value), or empty when the caller
     * has no access at all. LEFT JOIN means owners with no collaborator
     * row still match; the WHERE filters strangers.
     *
     * <p>Interface-based projection ({@link ProjectAccessRow}) keeps
     * Jackson out of the query path and lets Hibernate hydrate the
     * full {@code Project} entity for downstream business logic.
     */
    @Query("""
        SELECT p AS project,
               CASE WHEN p.user.id = :userId THEN 'OWNER' ELSE pc.role END AS role
        FROM Project p
        LEFT JOIN ProjectCollaborator pc
            ON pc.project.id = p.id AND pc.user.id = :userId
        WHERE p.id = :projectId
          AND (p.user.id = :userId OR pc.user.id = :userId)
    """)
    Optional<ProjectAccessRow> findAccessibleByIdAndUserId(
            @Param("projectId") UUID projectId,
            @Param("userId") UUID userId
    );

    /**
     * Dashboard query: every project the user can see, owned or shared,
     * with their effective role. Sorted newest-first like the existing
     * owner-only list.
     */
    @Query("""
        SELECT p AS project,
               CASE WHEN p.user.id = :userId THEN 'OWNER' ELSE pc.role END AS role
        FROM Project p
        LEFT JOIN ProjectCollaborator pc
            ON pc.project.id = p.id AND pc.user.id = :userId
        WHERE p.user.id = :userId OR pc.user.id = :userId
        ORDER BY p.createdAt DESC
    """)
    List<ProjectAccessRow> findAllAccessibleByUserId(@Param("userId") UUID userId);
}
