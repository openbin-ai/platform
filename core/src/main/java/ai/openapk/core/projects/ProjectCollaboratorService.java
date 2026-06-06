package ai.openapk.core.projects;

import ai.openapk.core.auth.User;
import ai.openapk.core.auth.UserRepository;
import ai.openapk.core.projects.dto.AddCollaboratorRequest;
import ai.openapk.core.projects.dto.CollaboratorResponse;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.server.ResponseStatusException;

import java.util.List;
import java.util.UUID;

/**
 * Manages {@link ProjectCollaborator} rows: list, add, remove. All
 * mutating ops are gated to the project owner via
 * {@link ProjectAccessGuard#requireOwner} — only the owner can change the
 * collaborator roster. Listing is gated at the VIEWER tier so a
 * collaborator can see who else has access to the project they're working
 * on.
 *
 * <p>Side-channel rule mirrored from the rest of the system: missing
 * project ➜ 404, project-not-yours ➜ 404 (no existence leak). Errors
 * specific to the operation (e.g. "user not found by email") surface
 * 404/409 as appropriate.
 */
@Service
public class ProjectCollaboratorService {

    private static final Logger log = LoggerFactory.getLogger(ProjectCollaboratorService.class);

    private final ProjectAccessGuard guard;
    private final ProjectCollaboratorRepository collabRepo;
    private final UserRepository userRepo;

    public ProjectCollaboratorService(
            ProjectAccessGuard guard,
            ProjectCollaboratorRepository collabRepo,
            UserRepository userRepo
    ) {
        this.guard = guard;
        this.collabRepo = collabRepo;
        this.userRepo = userRepo;
    }

    /** Owner + collaborators see the roster. */
    @Transactional(readOnly = true)
    public List<CollaboratorResponse> list(User caller, UUID projectId) {
        guard.requireRead(caller, projectId);
        return collabRepo.findAllByProjectId(projectId).stream()
                .map(c -> new CollaboratorResponse(
                        c.getUser().getId(),
                        c.getUser().getEmail(),
                        c.getUser().getDisplayName(),
                        c.getRole(),
                        c.getCreatedAt(),
                        c.getInvitedBy().getId()))
                .toList();
    }

    /**
     * Owner-only: invite a user (by email) at the given role. OWNER as a
     * requested role is rejected — ownership is a property of
     * {@code projects.user_id}, never granted via this table. Inviting
     * the project owner is also rejected (they already have full access).
     */
    @Transactional
    public CollaboratorResponse add(User caller, UUID projectId, AddCollaboratorRequest req) {
        Project project = guard.requireOwner(caller, projectId);
        if (req.role() == ProjectRole.OWNER) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST,
                    "OWNER cannot be granted as a collaborator role — there is only one project owner.");
        }
        User invitee = userRepo.findByEmailIgnoreCase(req.email())
                .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND,
                        "No account found for that email. The user must sign in once before they can be added."));
        if (invitee.getId().equals(project.getUser().getId())) {
            throw new ResponseStatusException(HttpStatus.CONFLICT,
                    "That user already owns this project.");
        }

        ProjectCollaborator row = collabRepo
                .findByProjectIdAndUserId(projectId, invitee.getId())
                .orElseGet(ProjectCollaborator::new);
        boolean isNew = row.getId() == null;
        if (isNew) {
            row.setId(new ProjectCollaborator.Id(projectId, invitee.getId()));
            row.setProject(project);
            row.setUser(invitee);
            row.setInvitedBy(caller);
        }
        row.setRole(req.role());
        collabRepo.save(row);
        log.info("collab {} project={} user={} role={} by={}",
                isNew ? "added" : "updated", projectId, invitee.getId(), req.role(), caller.getId());
        return new CollaboratorResponse(
                invitee.getId(), invitee.getEmail(), invitee.getDisplayName(),
                row.getRole(), row.getCreatedAt(), row.getInvitedBy().getId());
    }

    /** Owner-only: revoke a collaborator's access. */
    @Transactional
    public void remove(User caller, UUID projectId, UUID userId) {
        guard.requireOwner(caller, projectId);
        collabRepo.findByProjectIdAndUserId(projectId, userId)
                .ifPresent(collabRepo::delete);
        log.info("collab removed project={} user={} by={}", projectId, userId, caller.getId());
    }
}
