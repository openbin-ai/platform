package ai.openapk.core.scripts;

import ai.openapk.core.auth.User;
import ai.openapk.core.projects.Project;
import ai.openapk.core.projects.ProjectAccessGuard;
import ai.openapk.core.scripts.dto.CreateScriptRequest;
import ai.openapk.core.scripts.dto.ScriptResponse;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.server.ResponseStatusException;

import java.util.List;
import java.util.UUID;

/**
 * Scripts kept on a project. Readable by every roster member, writable by
 * editors. Same access convention as highlights: no access means 404.
 */
@Service
public class ProjectScriptService {

    /** Keeps the list endpoint bounded; a project with more needs cleanup, not paging. */
    static final int MAX_PER_PROJECT = 200;

    private final ProjectScriptRepository repo;
    private final ProjectAccessGuard guard;

    public ProjectScriptService(ProjectScriptRepository repo, ProjectAccessGuard guard) {
        this.repo = repo;
        this.guard = guard;
    }

    @Transactional(readOnly = true)
    public List<ScriptResponse> list(User caller, UUID projectId) {
        guard.requireRead(caller, projectId);
        return repo.findAllByProjectIdOrderByCreatedAtDesc(projectId).stream().map(ScriptResponse::from).toList();
    }

    @Transactional(readOnly = true)
    public ScriptResponse get(User caller, UUID projectId, UUID scriptId) {
        guard.requireRead(caller, projectId);
        return repo.findByIdAndProjectId(scriptId, projectId).map(ScriptResponse::from)
                .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND, "script not found"));
    }

    @Transactional
    public ScriptResponse create(User caller, UUID projectId, CreateScriptRequest req) {
        Project project = guard.requireEdit(caller, projectId);
        if (repo.countByProjectId(projectId) >= MAX_PER_PROJECT) {
            throw new ResponseStatusException(HttpStatus.CONFLICT,
                    "This project already holds " + MAX_PER_PROJECT + " scripts. Delete some first.");
        }
        ProjectScript s = new ProjectScript();
        s.setProjectId(project.getId());
        s.setName(req.name().trim());
        s.setLanguage(req.language().trim().toLowerCase());
        s.setDescription(blankToNull(req.description()));
        s.setContent(req.content());
        s.setSourceRef(blankToNull(req.sourceRef()));
        s.setCreatedBy(caller);
        return ScriptResponse.from(repo.save(s));
    }

    @Transactional
    public void delete(User caller, UUID projectId, UUID scriptId) {
        guard.requireEdit(caller, projectId);
        repo.findByIdAndProjectId(scriptId, projectId).ifPresent(repo::delete);
    }

    private static String blankToNull(String s) {
        return s == null || s.isBlank() ? null : s.trim();
    }
}
