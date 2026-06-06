package ai.openapk.core.projects;

import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;
import java.util.Optional;
import java.util.UUID;

/**
 * CRUD for {@link ProjectCollaborator}. The hot read path
 * (resolve-role-for-(user,project)) lives on the bespoke
 * {@code ProjectAccessRepository} so it can do a single JOIN against
 * {@code projects} and return the project entity + role together.
 *
 * <p>This repository is for the cold paths:
 * <ul>
 *   <li>List collaborators on a project (share-modal roster)</li>
 *   <li>List projects a user is collaborating on (dashboard)</li>
 *   <li>Insert / delete from the share-modal endpoints</li>
 * </ul>
 */
public interface ProjectCollaboratorRepository
        extends JpaRepository<ProjectCollaborator, ProjectCollaborator.Id> {

    /** Share-modal roster + avatar-stack rendering. */
    List<ProjectCollaborator> findAllByProjectId(UUID projectId);

    /** Dashboard "projects shared with me" list. */
    List<ProjectCollaborator> findAllByUserId(UUID userId);

    /** Exact lookup used when revoking access via DELETE endpoint. */
    Optional<ProjectCollaborator> findByProjectIdAndUserId(UUID projectId, UUID userId);

    /** Quick existence check used by the access guard for non-owners. */
    boolean existsByProjectIdAndUserId(UUID projectId, UUID userId);
}
