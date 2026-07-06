package ai.openapk.core.highlights;

import ai.openapk.core.auth.CurrentUserService;
import ai.openapk.core.highlights.dto.CreateHighlightRequest;
import ai.openapk.core.highlights.dto.HighlightResponse;
import ai.openapk.core.highlights.dto.UpdateHighlightRequest;
import jakarta.validation.Valid;
import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PatchMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;

import java.util.List;
import java.util.UUID;

/**
 * Highlights board CRUD, scoped under a project. Reads visible to any member;
 * writes are owner/editor (enforced in the service via ProjectAccessGuard).
 */
@RestController
@RequestMapping("/api/projects/{projectId}/highlights")
public class ProjectHighlightController {

    private final ProjectHighlightService service;
    private final CurrentUserService currentUser;

    public ProjectHighlightController(ProjectHighlightService service, CurrentUserService currentUser) {
        this.service = service;
        this.currentUser = currentUser;
    }

    @GetMapping
    public List<HighlightResponse> list(@PathVariable UUID projectId) {
        return service.list(currentUser.current(), projectId);
    }

    @PostMapping
    @ResponseStatus(HttpStatus.CREATED)
    public HighlightResponse create(@PathVariable UUID projectId, @Valid @RequestBody CreateHighlightRequest req) {
        return service.create(currentUser.current(), projectId, req);
    }

    @PatchMapping("/{highlightId}")
    public HighlightResponse update(
            @PathVariable UUID projectId,
            @PathVariable UUID highlightId,
            @Valid @RequestBody UpdateHighlightRequest req
    ) {
        return service.update(currentUser.current(), projectId, highlightId, req);
    }

    @DeleteMapping("/{highlightId}")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    public void delete(@PathVariable UUID projectId, @PathVariable UUID highlightId) {
        service.delete(currentUser.current(), projectId, highlightId);
    }
}
