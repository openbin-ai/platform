package ai.openapk.core.scripts;

import ai.openapk.core.auth.CurrentUserService;
import ai.openapk.core.scripts.dto.CreateScriptRequest;
import ai.openapk.core.scripts.dto.ScriptResponse;
import jakarta.validation.Valid;
import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;

import java.util.List;
import java.util.UUID;

@RestController
@RequestMapping("/api/projects/{projectId}/scripts")
public class ProjectScriptController {

    private final ProjectScriptService service;
    private final CurrentUserService currentUser;

    public ProjectScriptController(ProjectScriptService service, CurrentUserService currentUser) {
        this.service = service;
        this.currentUser = currentUser;
    }

    @GetMapping
    public List<ScriptResponse> list(@PathVariable("projectId") UUID projectId) {
        return service.list(currentUser.current(), projectId);
    }

    @GetMapping("/{scriptId}")
    public ScriptResponse get(@PathVariable("projectId") UUID projectId, @PathVariable("scriptId") UUID scriptId) {
        return service.get(currentUser.current(), projectId, scriptId);
    }

    @PostMapping
    @ResponseStatus(HttpStatus.CREATED)
    public ScriptResponse create(@PathVariable("projectId") UUID projectId, @Valid @RequestBody CreateScriptRequest req) {
        return service.create(currentUser.current(), projectId, req);
    }

    @DeleteMapping("/{scriptId}")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    public void delete(@PathVariable("projectId") UUID projectId, @PathVariable("scriptId") UUID scriptId) {
        service.delete(currentUser.current(), projectId, scriptId);
    }
}
