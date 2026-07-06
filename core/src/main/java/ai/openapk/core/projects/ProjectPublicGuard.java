package ai.openapk.core.projects;

import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.server.ResponseStatusException;

import java.util.UUID;

/**
 * Access gate for the ANONYMOUS public-read surface (/api/public/projects/**).
 * The counterpart to {@link ProjectAccessGuard}: that one resolves a signed-in
 * user's OWNER/EDITOR/VIEWER role; this one has no user at all and grants read
 * access purely on the project's {@code public_read_at} flag.
 *
 * <p>Like the authenticated guard, a private or missing project always 404s
 * with an identical message so an anonymous caller can't distinguish
 * "private but exists" from "doesn't exist" (no existence leak). Every
 * /api/public endpoint MUST route through here before touching project data.
 */
@Component
public class ProjectPublicGuard {

    private final ProjectRepository projectRepo;

    public ProjectPublicGuard(ProjectRepository projectRepo) {
        this.projectRepo = projectRepo;
    }

    /**
     * Resolve a publicly-readable project by id, or 404 if it is private or
     * absent. Returns the full {@link Project} for downstream read logic —
     * never expose write paths through this.
     */
    @Transactional(readOnly = true)
    public Project requirePublic(UUID projectId) {
        return projectRepo.findByIdAndPublicReadAtIsNotNull(projectId)
                .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND, "project not found"));
    }
}
