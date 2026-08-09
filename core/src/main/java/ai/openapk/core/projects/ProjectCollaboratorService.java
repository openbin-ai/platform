package ai.openapk.core.projects;

import ai.openapk.core.auth.User;
import ai.openapk.core.auth.UserRepository;
import ai.openapk.core.notifications.NotificationService;
import ai.openapk.core.projects.dto.AddCollaboratorRequest;
import ai.openapk.core.projects.dto.CollaboratorResponse;
import ai.openapk.core.projects.dto.ProjectMemberResponse;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.server.ResponseStatusException;

import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.stream.Collectors;

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
    private final ProjectPresenceRepository presenceRepo;
    private final UserRepository userRepo;
    private final NotificationService notifications;

    public ProjectCollaboratorService(
            ProjectAccessGuard guard,
            ProjectCollaboratorRepository collabRepo,
            ProjectPresenceRepository presenceRepo,
            UserRepository userRepo,
            NotificationService notifications
    ) {
        this.guard = guard;
        this.collabRepo = collabRepo;
        this.presenceRepo = presenceRepo;
        this.userRepo = userRepo;
        this.notifications = notifications;
    }

    /**
     * Full in-project roster: OWNER (from {@code projects.user_id}) plus every
     * collaborator, each with last-active presence. Any member (VIEWER+) can
     * read it — you can see who else is working the project you're on.
     */
    @Transactional(readOnly = true)
    public List<ProjectMemberResponse> members(User caller, UUID projectId) {
        Project project = guard.requireRead(caller, projectId);
        Map<UUID, Instant> lastActive = presenceRepo.findAllByProjectId(projectId).stream()
                .collect(Collectors.toMap(p -> p.getId().getUserId(), ProjectPresence::getLastActiveAt));
        UUID callerId = caller.getId();

        List<ProjectMemberResponse> out = new ArrayList<>();
        User owner = project.getUser();
        out.add(new ProjectMemberResponse(
                owner.getId(), owner.getEmail(), owner.getDisplayName(),
                ProjectRole.OWNER, project.getCreatedAt(), lastActive.get(owner.getId()),
                false, owner.getId().equals(callerId)));
        for (ProjectCollaborator c : collabRepo.findAllByProjectId(projectId)) {
            User u = c.getUser();
            out.add(new ProjectMemberResponse(
                    u.getId(), u.getEmail(), u.getDisplayName(),
                    c.getRole(), c.getCreatedAt(), lastActive.get(u.getId()),
                    false, u.getId().equals(callerId)));
        }
        return out;
    }

    /**
     * Record that the caller is active in the project right now. Gated at the
     * read tier — you must already have access to register presence, so this
     * can't be used to probe project existence. Called by a client heartbeat
     * on project open + periodically.
     */
    @Transactional
    public void heartbeat(User caller, UUID projectId) {
        guard.requireRead(caller, projectId);
        presenceRepo.touch(projectId, caller.getId());
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
     * Owner-only: invite a user — identified by user id (from researcher
     * search or the follow graph) or by email — at the given role. OWNER as
     * a requested role is rejected: ownership is a property of
     * {@code projects.user_id}, never granted via this table. Inviting the
     * project owner is also rejected (they already have full access).
     */
    @Transactional
    public CollaboratorResponse add(User caller, UUID projectId, AddCollaboratorRequest req) {
        Project project = guard.requireOwner(caller, projectId);
        if (req.role() == ProjectRole.OWNER) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST,
                    "OWNER cannot be granted as a collaborator role — there is only one project owner.");
        }
        // Two ways in: a user id picked from search / followers / following,
        // or a typed email address. The id path is the one the share modal
        // uses, since the social DTOs never expose email addresses.
        User invitee = req.byUserId()
                ? userRepo.findById(req.userId())
                        .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND,
                                "That user no longer exists."))
                : userRepo.findByEmailIgnoreCase(req.email())
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

        // Only email on a *fresh* invite. Updating an existing collaborator's
        // role (e.g. promoting VIEWER → EDITOR) shouldn't re-spam them; the
        // share-modal UI surfaces the new role inline.
        if (isNew) {
            notifications.notifyCollaboratorInvite(invitee, caller, project, req.role());
        }
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
