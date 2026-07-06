package ai.openapk.core.highlights;

import ai.openapk.core.auth.User;
import ai.openapk.core.highlights.dto.CreateHighlightRequest;
import ai.openapk.core.highlights.dto.HighlightResponse;
import ai.openapk.core.highlights.dto.UpdateHighlightRequest;
import ai.openapk.core.projects.Project;
import ai.openapk.core.projects.ProjectAccessGuard;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.server.ResponseStatusException;

import java.util.List;
import java.util.UUID;

/**
 * CRUD for the Highlights board. Reads gated at the read tier (any member,
 * and later public/fork viewers); writes at the edit tier (owner/editor).
 * Each highlight records {@code createdBy} for the contributor byline.
 */
@Service
public class ProjectHighlightService {

    private final ProjectAccessGuard guard;
    private final ProjectHighlightRepository repo;

    public ProjectHighlightService(ProjectAccessGuard guard, ProjectHighlightRepository repo) {
        this.guard = guard;
        this.repo = repo;
    }

    @Transactional(readOnly = true)
    public List<HighlightResponse> list(User caller, UUID projectId) {
        guard.requireRead(caller, projectId);
        return repo.findAllByProjectIdOrdered(projectId).stream().map(ProjectHighlightService::toResponse).toList();
    }

    @Transactional
    public HighlightResponse create(User caller, UUID projectId, CreateHighlightRequest req) {
        Project project = guard.requireEdit(caller, projectId);
        if (req.type() != HighlightType.VISUAL
                && (req.targetRef() == null || req.targetRef().isBlank())) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST,
                    "A " + req.type() + " highlight needs a target (function or file). "
                    + "Use a VISUAL highlight for a standalone screenshot.");
        }
        ProjectHighlight h = new ProjectHighlight();
        h.setProject(project);
        h.setType(req.type());
        h.setTargetRef(req.type() == HighlightType.VISUAL ? null : req.targetRef().trim());
        h.setMediaKey(blankToNull(req.mediaKey()));
        h.setTag(blankToNull(req.tag()));
        h.setNote(blankToNull(req.note()));
        h.setPosition(repo.maxPosition(projectId) + 1);
        h.setCreatedBy(caller);
        return toResponse(repo.save(h));
    }

    @Transactional
    public HighlightResponse update(User caller, UUID projectId, UUID highlightId, UpdateHighlightRequest req) {
        guard.requireEdit(caller, projectId);
        ProjectHighlight h = repo.findByIdAndProjectId(highlightId, projectId)
                .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND, "highlight not found"));
        if (req.tag() != null) h.setTag(blankToNull(req.tag()));
        if (req.note() != null) h.setNote(blankToNull(req.note()));
        if (req.position() != null) h.setPosition(req.position());
        return toResponse(repo.save(h));
    }

    @Transactional
    public void delete(User caller, UUID projectId, UUID highlightId) {
        guard.requireEdit(caller, projectId);
        repo.findByIdAndProjectId(highlightId, projectId).ifPresent(repo::delete);
    }

    private static String blankToNull(String s) {
        return (s == null || s.isBlank()) ? null : s.trim();
    }

    private static HighlightResponse toResponse(ProjectHighlight h) {
        User by = h.getCreatedBy();
        return new HighlightResponse(
                h.getId(), h.getType(), h.getTargetRef(), h.getMediaKey(),
                h.getTag(), h.getNote(), h.getPosition(),
                by != null ? by.getId() : null,
                by != null ? by.getDisplayName() : null,
                h.getCreatedAt());
    }
}
