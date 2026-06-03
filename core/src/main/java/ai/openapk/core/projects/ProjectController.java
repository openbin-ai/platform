package ai.openapk.core.projects;

import ai.openapk.core.auth.CurrentUserService;
import ai.openapk.core.projects.dto.FileContentResponse;
import ai.openapk.core.projects.dto.FileNode;
import ai.openapk.core.projects.dto.ProjectResponse;
import ai.openapk.core.projects.dto.UpdateProjectRequest;
import jakarta.validation.Valid;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PatchMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.multipart.MultipartFile;

import java.util.List;
import java.util.UUID;

@RestController
@RequestMapping("/api/projects")
public class ProjectController {

    private final ProjectService service;
    private final CurrentUserService currentUser;

    public ProjectController(ProjectService service, CurrentUserService currentUser) {
        this.service = service;
        this.currentUser = currentUser;
    }

    @GetMapping
    public List<ProjectResponse> list() {
        return service.list(currentUser.current());
    }

    @PostMapping
    @ResponseStatus(HttpStatus.CREATED)
    public ProjectResponse upload(
            @RequestParam("file") MultipartFile file,
            // openapk.ai sends "APK", openbin.ai sends "BIN". Optional for back-
            // compat with any client predating the kind field — see sniffKind.
            @RequestParam(value = "kind", required = false) ProjectKind kind,
            // BIN-only hint passed through to the Ghidra worker. Ignored for
            // APK uploads. Defaults to "auto" on the service side.
            @RequestParam(value = "arch", required = false) String arch
    ) {
        return service.upload(currentUser.current(), file, kind, arch);
    }

    @GetMapping("/{id}")
    public ProjectResponse get(@PathVariable UUID id) {
        return service.get(currentUser.current(), id);
    }

    @PatchMapping("/{id}")
    public ProjectResponse update(@PathVariable UUID id, @Valid @RequestBody UpdateProjectRequest req) {
        return service.update(currentUser.current(), id, req);
    }

    @DeleteMapping("/{id}")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    public void delete(@PathVariable UUID id) {
        service.delete(currentUser.current(), id);
    }

    @GetMapping("/{id}/files")
    public FileNode tree(@PathVariable UUID id) {
        return service.fileTree(currentUser.current(), id);
    }

    @GetMapping("/{id}/file")
    public FileContentResponse file(@PathVariable UUID id, @RequestParam("path") String path) {
        return service.readFile(currentUser.current(), id, path);
    }

    /**
     * Returns the Ghidra worker's full extract JSON for a BIN project —
     * functions (with decompiled C + disassembly + xrefs), strings, imports,
     * metadata. BIN-only; APK projects 400.
     *
     * <p>Streamed as the raw stored String so we avoid the parse-then-re-
     * serialize cost on the big blob; Content-Type is forced to JSON so
     * browsers and fetch() see a proper application/json response.
     */
    @GetMapping("/{id}/binary-analysis")
    public ResponseEntity<String> binaryAnalysis(@PathVariable UUID id) {
        String json = service.getBinaryAnalysisJson(currentUser.current(), id);
        return ResponseEntity.ok()
                .contentType(MediaType.APPLICATION_JSON)
                .body(json);
    }
}
