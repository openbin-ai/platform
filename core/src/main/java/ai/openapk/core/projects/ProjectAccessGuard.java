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
 *
 * <p><b>The 404 must not roll back the caller's transaction.</b> These
 * methods are {@code @Transactional}, so when one is called from inside
 * another transactional method it JOINS that transaction — and a
 * RuntimeException escaping it makes the interceptor set rollback-only on the
 * shared transaction. A caller that catches the 404 to fall back (fork, which
 * also accepts public projects) then commits successfully as far as it can
 * tell and gets {@code UnexpectedRollbackException} → HTTP 500. Hence
 * {@code noRollbackFor}: a 404 here is an authorization answer, not a failed
 * write, and nothing has been mutated that needs undoing. Callers that branch
 * on the outcome should still prefer {@link #findReadable}.
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
    @Transactional(readOnly = true, noRollbackFor = ResponseStatusException.class)
    public Project requireRead(User user, UUID projectId) {
        return resolve(user, projectId).getProject();
    }

    /**
     * Returns the project if the caller is OWNER or EDITOR. 404 for
     * VIEWER or no-access. Use for mutating endpoints: rename
     * apply/suggest, deobfuscation generate, native re-ingest, report
     * section update, analyze runs.
     */
    @Transactional(readOnly = true, noRollbackFor = ResponseStatusException.class)
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
    @Transactional(readOnly = true, noRollbackFor = ResponseStatusException.class)
    public Project requireOwner(User user, UUID projectId) {
        ProjectAccessRow row = resolve(user, projectId);
        if (!ProjectRole.valueOf(row.getRole()).isOwner()) {
            throw new ResponseStatusException(HttpStatus.NOT_FOUND, "project not found");
        }
        return row.getProject();
    }

    /**
     * Non-throwing counterpart to {@link #requireRead}: empty when the caller
     * has no role on the project (or it doesn't exist).
     *
     * <p>Use this — never the throwing variant — when the caller intends to
     * FALL BACK on failure (e.g. fork, which also accepts public projects).
     * A 404 out of {@code requireRead} is thrown from inside its own
     * {@code @Transactional} method, so the transaction interceptor marks the
     * caller's transaction rollback-only on the way out. Catching it looks
     * harmless and then blows up at commit with UnexpectedRollbackException.
     */
    @Transactional(readOnly = true)
    public Optional<Project> findReadable(User user, UUID projectId) {
        return projectRepo.findAccessibleByIdAndUserId(projectId, user.getId())
                .map(ProjectAccessRow::getProject);
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
