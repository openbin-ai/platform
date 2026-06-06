package ai.openapk.core.projects;

import ai.openapk.core.auth.User;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.server.ResponseStatusException;

import java.util.List;
import java.util.Optional;
import java.util.UUID;

/**
 * Single entry point for "does this user have access to this project,
 * and at what tier?" Every service that used to call
 * {@code projectRepo.findByIdAndUserId(projectId, userId)} (or an
 * equivalent {@code loadOwned} / {@code requireOwned} helper) routes
 * through here instead, so collaboration via {@link ProjectCollaborator}
 * works uniformly across the backend.
 *
 * <p>Failure mode is always 404, never 403: leaking "this project
 * exists but you can't see it" is the kind of side-channel that the
 * old per-service helpers already avoided, and we preserve that here.
 *
 * <p>The guard does NOT enforce {@code status == READY} on the project;
 * services that require ready state continue to call their own
 * {@code requireReady} helper after the access check. Mixing the two
 * concerns into one helper makes 409 vs 404 ambiguous.
 */
@Component
public class ProjectAccessGuard {

    private final ProjectRepository projectRepo;

    public ProjectAccessGuard(ProjectRepository projectRepo) {
        this.projectRepo = projectRepo;
    }

    /**
     * Returns the project if the caller has ANY access (owner, editor,
     * or viewer). 404 otherwise. Use for read endpoints: GET listings,
     * file reads, analysis fetches, AI Q&A, lazy-cache rebuilds.
     */
    @Transactional(readOnly = true)
    public Project requireRead(User user, UUID projectId) {
        return resolve(user, projectId).getProject();
    }

    /**
     * Returns the project if the caller is OWNER or EDITOR. 404 for
     * VIEWER or no-access. Use for mutating endpoints: rename
     * apply/suggest, deobfuscation generate, native re-ingest, report
     * section update, analyze runs.
     */
    @Transactional(readOnly = true)
    public Project requireEdit(User user, UUID projectId) {
        ProjectAccessRow row = resolve(user, projectId);
        if (!ProjectRole.valueOf(row.getRole()).canEdit()) {
            // Same 404 to avoid leaking existence to a viewer who
            // discovered they can't write.
            throw new ResponseStatusException(HttpStatus.NOT_FOUND, "project not found");
        }
        return row.getProject();
    }

    /**
     * Returns the project only when the caller is the owner. 404 for
     * collaborators or strangers. Use for irreversible / privileged
     * ops: delete project, publishToCommunity, unpublishFromCommunity,
     * change collaborator roster.
     */
    @Transactional(readOnly = true)
    public Project requireOwner(User user, UUID projectId) {
        ProjectAccessRow row = resolve(user, projectId);
        if (!ProjectRole.valueOf(row.getRole()).isOwner()) {
            throw new ResponseStatusException(HttpStatus.NOT_FOUND, "project not found");
        }
        return row.getProject();
    }

    /**
     * Resolve the caller's role on a project without throwing. Used by
     * {@code ProjectResponse} to embed the caller's effective tier in
     * the API response so the frontend can hide edit affordances for
     * viewers.
     */
    @Transactional(readOnly = true)
    public Optional<ProjectRole> roleOf(User user, UUID projectId) {
        return projectRepo.findAccessibleByIdAndUserId(projectId, user.getId())
                .map(row -> ProjectRole.valueOf(row.getRole()));
    }

    /**
     * List every project the user can access (owned + shared), with
     * their role attached. Replaces the old
     * {@code findAllByUserIdOrderByCreatedAtDesc} on the dashboard
     * endpoint so collaborators see projects shared with them.
     */
    @Transactional(readOnly = true)
    public List<ProjectAccessRow> listAccessible(User user) {
        return projectRepo.findAllAccessibleByUserId(user.getId());
    }

    private ProjectAccessRow resolve(User user, UUID projectId) {
        return projectRepo.findAccessibleByIdAndUserId(projectId, user.getId())
                .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND, "project not found"));
    }
}
