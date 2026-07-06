package ai.openapk.core.projects;

import ai.openapk.core.auth.CurrentUserService;
import ai.openapk.core.projects.dto.AddCollaboratorRequest;
import ai.openapk.core.projects.dto.CollaboratorResponse;
import ai.openapk.core.projects.dto.DedupMatch;
import ai.openapk.core.projects.dto.ProjectMemberResponse;
import ai.openapk.core.projects.dto.FileContentResponse;
import ai.openapk.core.projects.dto.FileNode;
import ai.openapk.core.projects.dto.ProjectResponse;
import ai.openapk.core.projects.dto.UpdateProjectRequest;
import jakarta.validation.Valid;
import org.springframework.core.io.InputStreamResource;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PatchMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
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
    private final ProjectCollaboratorService collaboratorService;
    private final CurrentUserService currentUser;
    private final DedupService dedupService;

    public ProjectController(ProjectService service,
                             ProjectCollaboratorService collaboratorService,
                             CurrentUserService currentUser,
                             DedupService dedupService) {
        this.service = service;
        this.collaboratorService = collaboratorService;
        this.currentUser = currentUser;
        this.dedupService = dedupService;
    }

    @GetMapping
    public List<ProjectResponse> list() {
        return service.list(currentUser.current());
    }

    /**
     * Hash-dedup lookup: PUBLIC projects with this sha256, most-upvoted first.
     * The CLI calls this before decompiling to offer forking an existing public
     * analysis. A literal path segment, so it takes precedence over /{id}.
     * Public-data-only, but kept on the authenticated surface (the CLI is
     * signed in and forks via the authenticated fork endpoint).
     */
    @GetMapping("/dedup")
    public List<DedupMatch> dedup(@RequestParam("sha256") String sha256) {
        return dedupService.findPublicByHash(sha256);
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
            @RequestParam(value = "arch", required = false) String arch,
            // APK-only: tar.gz of a jadx-worker output tree produced by the
            // desktop CLI. When present, the cloud worker is skipped entirely
            // (and no worker-quota slot is charged) — the post-decompile
            // pipeline runs against this tree instead. See JadxSunsetMessage.
            @RequestParam(value = "decompiledTree", required = false) MultipartFile decompiledTree
    ) {
        return service.upload(currentUser.current(), file, kind, arch, decompiledTree);
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

    /**
     * Make the project publicly readable at /api/public/projects/{id}
     * (owner-only). Separate from report community-publish. Idempotent.
     */
    @PutMapping("/{id}/public")
    public ProjectResponse makePublic(@PathVariable UUID id) {
        return service.setPublic(currentUser.current(), id, true);
    }

    /** Revoke anonymous public read (owner-only). Idempotent. */
    @DeleteMapping("/{id}/public")
    public ProjectResponse makePrivate(@PathVariable UUID id) {
        return service.setPublic(currentUser.current(), id, false);
    }

    /**
     * Fork a project into a new one owned by the caller, sharing the source's
     * analysis blob read-only. Source must be readable-by-caller or public,
     * BIN, and READY. Returns the new fork (201).
     */
    @PostMapping("/{id}/fork")
    @ResponseStatus(HttpStatus.CREATED)
    public ProjectResponse fork(@PathVariable UUID id) {
        return service.fork(currentUser.current(), id);
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
     * Stream a single file from the project workspace as raw bytes
     * ({@code application/octet-stream}). Mirrors {@link #file} but
     * skips UTF-8 decode + rename rewrite — used by the openapk
     * frontend's "Download .so" UX so the user can run Ghidra locally
     * on the original binary.
     *
     * <p>Force-download via {@code Content-Disposition: attachment} so
     * a browser-side click reliably saves to disk instead of trying to
     * render the body inline.
     */
    @GetMapping("/{id}/file/raw")
    public ResponseEntity<InputStreamResource> fileRaw(
            @PathVariable UUID id,
            @RequestParam("path") String path
    ) {
        ProjectService.RawFile raw = service.readFileRaw(currentUser.current(), id, path);
        return ResponseEntity.ok()
                .contentType(MediaType.APPLICATION_OCTET_STREAM)
                .contentLength(raw.sizeBytes())
                .header("Content-Disposition", "attachment; filename=\"" + raw.filename() + "\"")
                .body(new InputStreamResource(raw.body()));
    }

    /**
     * Full in-project member roster: owner + collaborators, each with role and
     * last-active presence. Visible to any member. This is what the project
     * view renders for "who's working this project"; {@code /collaborators}
     * (below) stays the collaborators-only list the share modal uses.
     */
    @GetMapping("/{id}/members")
    public List<ProjectMemberResponse> members(@PathVariable UUID id) {
        return collaboratorService.members(currentUser.current(), id);
    }

    /**
     * Presence heartbeat — record that the caller is active in this project.
     * Pinged by the client on project open and periodically. Read-tier gated.
     */
    @PostMapping("/{id}/presence")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    public void presence(@PathVariable UUID id) {
        collaboratorService.heartbeat(currentUser.current(), id);
    }

    /**
     * Project collaborator roster — visible to the owner and to any
     * collaborator (so they can see who else has access on a shared
     * project). Mutating ops below are owner-only.
     */
    @GetMapping("/{id}/collaborators")
    public List<CollaboratorResponse> listCollaborators(@PathVariable UUID id) {
        return collaboratorService.list(currentUser.current(), id);
    }

    /**
     * Add a collaborator to the project at VIEWER or EDITOR role.
     * Owner-only. Email-based invite — the invitee must already have
     * signed into the platform at least once.
     */
    @PostMapping("/{id}/collaborators")
    @ResponseStatus(HttpStatus.CREATED)
    public CollaboratorResponse addCollaborator(
            @PathVariable UUID id,
            @Valid @RequestBody AddCollaboratorRequest req
    ) {
        return collaboratorService.add(currentUser.current(), id, req);
    }

    /** Revoke a collaborator's access. Owner-only. */
    @DeleteMapping("/{id}/collaborators/{userId}")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    public void removeCollaborator(@PathVariable UUID id, @PathVariable UUID userId) {
        collaboratorService.remove(currentUser.current(), id, userId);
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
