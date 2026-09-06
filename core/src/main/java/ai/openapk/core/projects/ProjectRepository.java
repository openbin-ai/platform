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

    /**
     * Anonymous public-read resolution: a project is returned ONLY when it has
     * been made publicly readable ({@code public_read_at IS NOT NULL}). Used by
     * {@link ProjectPublicGuard} for the /api/public/projects/** surface — a
     * private (or nonexistent) project yields empty, which the guard turns into
     * an identical 404 so anonymous probing can't distinguish the two.
     */
    Optional<Project> findByIdAndPublicReadAtIsNotNull(UUID id);

    /**
     * findById with the owner eagerly fetched. For code that runs OUTSIDE any
     * transaction (the async decompile/ingest pipeline) and then dereferences
     * {@code project.getUser()} — e.g. the decompile-complete notification —
     * where the default lazy proxy would throw LazyInitializationException.
     */
    @Query("SELECT p FROM Project p JOIN FETCH p.user WHERE p.id = :id")
    Optional<Project> findByIdWithUser(@Param("id") UUID id);

    /**
     * "Is this project anonymously readable?" without hydrating it. Used to
     * decide whether a fork's "forked from" link should point at the public
     * view — the fork's owner usually has no role on the source, so the
     * authenticated view would 404 on them.
     */
    boolean existsByIdAndPublicReadAtIsNotNull(UUID id);

    /**
     * How many projects reference this analysis blob. Used to refcount the
     * shared sha256-keyed blob on delete — only the last referencing project
     * may delete the object. Includes the row being deleted until commit.
     */
    long countByBinaryAnalysisS3Key(String binaryAnalysisS3Key);

    /** Direct forks of a project (lineage walk / fork list). */
    List<Project> findAllByForkedFromIdOrderByCreatedAtDesc(UUID forkedFromId);

    /** Members of a bundle in add-order — drives the overview list + tab bar. */
    List<Project> findAllByBundleIdOrderByCreatedAtAsc(UUID bundleId);

    /** How many projects still belong to a bundle (auto-remove-when-empty check). */
    long countByBundleId(UUID bundleId);
}
