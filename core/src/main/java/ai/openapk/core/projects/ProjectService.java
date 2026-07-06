package ai.openapk.core.projects;

import ai.openapk.core.auth.User;
import ai.openapk.core.config.OpenApkProperties;
import ai.openapk.core.projects.analysis.AnalysisStorageService;
import ai.openapk.core.projects.analysis.BinaryAnalysisLoader;
import ai.openapk.core.projects.dto.FileContentResponse;
import ai.openapk.core.projects.dto.FileNode;
import ai.openapk.core.projects.dto.ProjectResponse;
import ai.openapk.core.projects.dto.UpdateProjectRequest;
import ai.openapk.core.renames.RenameService;
import ai.openapk.core.projects.storage.ProjectStorage;
import ai.openapk.core.symbols.usages.UsageIndexerService;
import ai.openapk.core.notifications.NotificationService;
import ai.openapk.core.usage.WorkerQuotaService;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.context.annotation.Lazy;
import org.springframework.http.HttpStatus;
import org.springframework.scheduling.annotation.Async;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.transaction.support.TransactionSynchronization;
import org.springframework.transaction.support.TransactionSynchronizationManager;
import org.springframework.web.multipart.MultipartFile;
import org.springframework.web.server.ResponseStatusException;
import tools.jackson.core.type.TypeReference;
import tools.jackson.databind.ObjectMapper;

import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.security.DigestOutputStream;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.time.Instant;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.HexFormat;
import java.util.List;
import java.util.UUID;
import java.util.stream.Stream;

@Service
public class ProjectService {

    private static final Logger log = LoggerFactory.getLogger(ProjectService.class);

    private final ProjectRepository repo;
    private final ProjectStorage storage;
    private final JadxDecompileService jadx;
    private final BinaryDecompileService binaryDecompile;
    private final OpenApkProperties props;
    private final RenameService renameService;
    private final ObjectMapper mapper;
    private final UsageIndexerService usageIndexer;
    private final WorkerQuotaService workerQuota;
    private final NotificationService notifications;
    // Null when openapk.analysis-storage.bucket isn't set (dev / pre-S3
    // configs). Code paths that return a ProjectResponse check for null
    // before minting a CloudFront signed URL and pass null to
    // ProjectResponse.from() to disable URL embedding.
    private final AnalysisStorageService analysisStorage;
    private final BinaryAnalysisLoader analysisLoader;

    /**
     * Self-injected Spring proxy. Required for {@code @Async scheduleDecompile}
     * to actually fire — Spring's default CGLIB proxy only intercepts external
     * calls, so {@code this.scheduleDecompile(...)} runs synchronously on the
     * request thread and blocks the upload POST for the full decompile
     * duration. Going through {@code self.scheduleDecompile(...)} hits the
     * proxy and dispatches on the executor as intended. {@code @Lazy} breaks
     * the otherwise-circular constructor dependency.
     */
    private final ProjectService self;
    private final ProjectAccessGuard guard;
    private final ProjectPublicGuard publicGuard;

    public ProjectService(
            @Lazy ProjectService self,
            ProjectRepository repo,
            ProjectStorage storage,
            JadxDecompileService jadx,
            BinaryDecompileService binaryDecompile,
            OpenApkProperties props,
            RenameService renameService,
            ObjectMapper mapper,
            UsageIndexerService usageIndexer,
            WorkerQuotaService workerQuota,
            NotificationService notifications,
            @Autowired(required = false) AnalysisStorageService analysisStorage,
            BinaryAnalysisLoader analysisLoader,
            ProjectAccessGuard guard,
            ProjectPublicGuard publicGuard
    ) {
        this.self = self;
        this.repo = repo;
        this.storage = storage;
        this.jadx = jadx;
        this.binaryDecompile = binaryDecompile;
        this.props = props;
        this.renameService = renameService;
        this.mapper = mapper;
        this.usageIndexer = usageIndexer;
        this.workerQuota = workerQuota;
        this.notifications = notifications;
        this.analysisStorage = analysisStorage;
        this.analysisLoader = analysisLoader;
        this.guard = guard;
        this.publicGuard = publicGuard;
    }

    /**
     * Build the URL-minter lambda passed to {@link ProjectResponse#from}.
     * Returns null when CDN signing isn't configured — frontend then
     * falls back to inline JSONB reads.
     */
    private java.util.function.Function<String, String> urlSigner() {
        if (analysisStorage == null || !analysisStorage.cdnConfigured()) return null;
        return analysisStorage::signDownloadUrl;
    }

    @Transactional(readOnly = true)
    public List<ProjectResponse> list(User user) {
        // Returns owned projects PLUS projects shared with the caller via
        // ProjectCollaborator, with each row's effective role attached so
        // the frontend can hide edit affordances for VIEWERs and label
        // shared projects in the dashboard.
        return guard.listAccessible(user).stream()
                .map(row -> ProjectResponse.from(
                        row.getProject(),
                        null,
                        ProjectRole.valueOf(row.getRole())))
                .toList();
    }

    @Transactional(readOnly = true)
    public ProjectResponse get(User user, UUID id) {
        // Detail endpoint mints the signed analysis URL so the frontend
        // can fetch the worker JSON directly from CloudFront. List
        // endpoint intentionally skips signing — one signature per row
        // at page render is wasteful, and the list view doesn't need
        // the body. The access query hands back project + role in one
        // round trip (see ProjectRepository.findAccessibleByIdAndUserId).
        var row = repo.findAccessibleByIdAndUserId(id, user.getId())
                .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND, "project not found"));
        return ProjectResponse.from(row.getProject(), urlSigner(), ProjectRole.valueOf(row.getRole()));
    }

    /**
     * Owner-only toggle of the project's anonymous public-read visibility.
     * Sets/clears {@code public_read_at}; independent of report community
     * publish. Returns the refreshed summary (with a signed URL, since the
     * caller is the authenticated owner) so the UI reflects the new state.
     */
    @Transactional
    public ProjectResponse setPublic(User user, UUID id, boolean makePublic) {
        Project project = guard.requireOwner(user, id);
        if (makePublic && project.getPublicReadAt() == null) {
            project.setPublicReadAt(Instant.now());
            repo.save(project);
        } else if (!makePublic && project.getPublicReadAt() != null) {
            project.setPublicReadAt(null);
            repo.save(project);
        }
        return ProjectResponse.from(project, urlSigner(), ProjectRole.OWNER);
    }

    /**
     * Anonymous public-read summary. Gated purely on {@code public_read_at};
     * deliberately passes a NULL url signer so no short-TTL CloudFront bearer
     * capability is minted for an anonymous caller — the public frontend reads
     * the analysis through {@link #getBinaryAnalysisJsonPublic} instead. Role
     * is null (anonymous).
     */
    @Transactional(readOnly = true)
    public ProjectResponse getPublic(UUID id) {
        return ProjectResponse.from(publicGuard.requirePublic(id), null, null);
    }

    @Transactional
    public ProjectResponse upload(User user, MultipartFile file, ProjectKind requestedKind, String archHint,
                                  MultipartFile decompiledTree) {
        if (file.isEmpty()) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "uploaded file is empty");
        }

        // Trust an explicit kind from the frontend (openapk.ai vs openbin.ai
        // both go through the same backend, and each declares what it sends).
        // Only sniff when the caller leaves it unspecified — keeps backward
        // compat with existing API clients while letting BIN uploads succeed.
        ProjectKind kind = requestedKind != null ? requestedKind : sniffKind(file);
        // Cloud Ghidra sunset gate: BIN uploads have nowhere to run server-side
        // when the worker is disabled. Reject up front (503) instead of saving
        // the upload, persisting it to S3, and only THEN failing in the async
        // decompile — that would waste a quota slot and look like a crash.
        if (kind == ProjectKind.BIN && ghidraWorkerDisabled()) {
            throw new ResponseStatusException(HttpStatus.SERVICE_UNAVAILABLE,
                    GhidraSunsetMessage.TEXT);
        }
        // Cloud JADX sunset gate, same shape: an APK upload with no
        // CLI-decompiled tree would need the cloud worker. APK uploads that
        // bring their own tree (the CLI flow) sail through — no worker, no
        // quota charge.
        boolean hasCliTree = decompiledTree != null && !decompiledTree.isEmpty();
        if (hasCliTree && kind != ProjectKind.APK) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST,
                    "decompiledTree is only valid for APK uploads");
        }
        if (kind == ProjectKind.APK && !hasCliTree && jadxWorkerDisabled()) {
            throw new ResponseStatusException(HttpStatus.SERVICE_UNAVAILABLE,
                    JadxSunsetMessage.TEXT);
        }
        String filename = sanitizeFilename(file.getOriginalFilename(), kind);

        // Persist the row first to get a generated ID (and so the user sees it immediately).
        var project = new Project();
        project.setUser(user);
        project.setKind(kind);
        project.setOriginalFilename(filename);
        project.setName(filename);
        project.setSizeBytes(file.getSize());
        project.setStatus(ProjectStatus.UPLOADED);
        project.setWorkflowStatus(WorkflowStatus.NEW);
        project.setAnalysisMode(ai.openapk.core.analysis.AnalysisMode.MALWARE);
        project.setSha256("pending");
        if (kind == ProjectKind.BIN) {
            // Store the arch hint up front so the worker can use it. Defaults
            // to "auto" — Ghidra will detect for well-formed ELF/PE/Mach-O.
            project.setArch(archHint != null && !archHint.isBlank() ? archHint : "auto");
        }
        project = repo.saveAndFlush(project);

        // Stream the upload to disk, computing sha256 as we go.
        Path target = (kind == ProjectKind.BIN)
                ? storage.binaryPath(user.getId(), project.getId())
                : storage.apkPath(user.getId(), project.getId());
        String sha;
        try {
            Files.createDirectories(target.getParent());
            MessageDigest md = MessageDigest.getInstance("SHA-256");
            try (InputStream in = file.getInputStream();
                 OutputStream out = Files.newOutputStream(target);
                 DigestOutputStream dout = new DigestOutputStream(out, md)) {
                in.transferTo(dout);
            }
            sha = HexFormat.of().formatHex(md.digest());
        } catch (IOException | NoSuchAlgorithmException e) {
            storage.deleteProject(user.getId(), project.getId());
            repo.delete(project);
            throw new ResponseStatusException(HttpStatus.INTERNAL_SERVER_ERROR,
                    "failed to store upload: " + e.getMessage());
        }

        // Push the freshly-uploaded APK/binary to durable storage. On the fs
        // backend this is a no-op; on S3 it pushes to the bucket. Must happen
        // BEFORE we hand off to the decompile worker — the worker reads the
        // file via storage.apkPath() which on a cold S3 task would otherwise
        // miss-and-fetch a file that hasn't been persisted yet.
        try {
            storage.afterUpload(user.getId(), project.getId());
        } catch (IOException e) {
            storage.deleteProject(user.getId(), project.getId());
            repo.delete(project);
            throw new ResponseStatusException(HttpStatus.INTERNAL_SERVER_ERROR,
                    "failed to persist upload: " + e.getMessage());
        }

        // CLI flow: stash the user-supplied decompile tree next to the APK so
        // the async ingest can pick it up. Disk-local + transient — the async
        // task runs in this same JVM and deletes it after extraction, so it
        // never needs to reach durable storage.
        if (hasCliTree) {
            try {
                Files.copy(decompiledTree.getInputStream(),
                        cliTreePath(user.getId(), project.getId()),
                        java.nio.file.StandardCopyOption.REPLACE_EXISTING);
            } catch (IOException e) {
                storage.deleteProject(user.getId(), project.getId());
                repo.delete(project);
                throw new ResponseStatusException(HttpStatus.INTERNAL_SERVER_ERROR,
                        "failed to store decompiled tree: " + e.getMessage());
            }
        }

        project.setSha256(sha);
        project.setStatus(ProjectStatus.DECOMPILING);
        repo.save(project);

        // Kick off async decompile AFTER this transaction commits. Two problems
        // we solve by registering an afterCommit synchronization instead of
        // calling scheduleDecompile() directly here:
        //
        //   1. Race: the @Async dispatch returns immediately, so the decompile
        //      worker can pick up the task and run runDecompile()'s findById
        //      BEFORE this transaction commits — Postgres READ_COMMITTED won't
        //      let the worker see the not-yet-committed row, so runDecompile
        //      throws "project disappeared" against a project that does
        //      eventually exist on disk. Fast workers (the new jadx-worker
        //      especially) lose this race almost every time.
        //
        //   2. Correctness on rollback: if this method throws after the @Async
        //      dispatch, the upload tx rolls back and there is no project row,
        //      but the queued decompile task still runs and logs an error.
        //      afterCommit only fires on successful commit, so the decompile
        //      is naturally tied to the row's existence.
        //
        // Must still invoke through the self-injected Spring proxy so the
        // @Async semantics kick in (a plain this.scheduleDecompile bypasses
        // the proxy and runs synchronously on this thread).
        final java.util.UUID userId = user.getId();
        final java.util.UUID projectId = project.getId();
        final boolean cliTree = hasCliTree;
        TransactionSynchronizationManager.registerSynchronization(new TransactionSynchronization() {
            @Override
            public void afterCommit() {
                if (cliTree) {
                    self.scheduleCliTreeIngest(userId, projectId);
                } else {
                    self.scheduleDecompile(userId, projectId);
                }
            }
        });

        return ProjectResponse.from(project, urlSigner());
    }

    private boolean ghidraWorkerDisabled() {
        return props.ghidra() != null && Boolean.TRUE.equals(props.ghidra().workerDisabled());
    }

    private boolean jadxWorkerDisabled() {
        return props.jadx() != null && Boolean.TRUE.equals(props.jadx().workerDisabled());
    }

    /** Transient on-disk location of a CLI-supplied decompile tree tar.gz. */
    private Path cliTreePath(UUID userId, UUID projectId) {
        return storage.apkPath(userId, projectId).getParent().resolve("decompiled-tree.tar.gz");
    }

    @Async("decompileExecutor")
    public void scheduleDecompile(UUID userId, UUID projectId) {
        // Resolve project kind up front so the quota audit row tags the right
        // worker type. Cheap repo hit; happens off the request thread anyway.
        ProjectKind kind = repo.findById(projectId).map(Project::getKind).orElse(null);
        if (kind == null) {
            log.error("decompile scheduled for missing project {}", projectId);
            return;
        }
        String workerType = kind == ProjectKind.BIN ? "ghidra" : "jadx";

        UUID runId;
        try {
            runId = workerQuota.reserveRun(userId, projectId, workerType);
        } catch (ResponseStatusException quotaErr) {
            // Quota gate fired before the worker was ever invoked. Bill is
            // safe; surface the cause on the project row so the UI can show
            // the upgrade/CLI path.
            log.warn("worker quota blocked decompile for user {} project {}: {}",
                    userId, projectId, quotaErr.getReason());
            markFailed(projectId, quotaErr.getReason());
            return;
        }

        try {
            runDecompile(userId, projectId);
            workerQuota.markComplete(runId, true, null);
        } catch (Exception e) {
            log.error("decompile failed for project {}: {}", projectId, e.toString(), e);
            markFailed(projectId, abbreviate(e.toString()));
            workerQuota.markComplete(runId, false, e.toString());
        }
    }

    @Transactional
    protected void runDecompile(UUID userId, UUID projectId) throws IOException, InterruptedException {
        // Stamp the start time so the UI can render elapsed seconds against
        // whatever phase is current.
        markStartedAt(projectId);

        ProjectKind kind = repo.findById(projectId)
                .map(Project::getKind)
                .orElseThrow(() -> new IllegalStateException("project disappeared: " + projectId));

        if (kind == ProjectKind.BIN) {
            runBinaryDecompile(userId, projectId);
        } else {
            runApkDecompile(userId, projectId);
        }
    }

    /**
     * CLI ingest pipeline: the decompile already happened on the user's
     * machine; extract their tree and run the same post-decompile steps as
     * the worker path. Deliberately NOT routed through scheduleDecompile —
     * no cloud worker runs, so no worker-quota slot is reserved or charged.
     */
    @Async("decompileExecutor")
    public void scheduleCliTreeIngest(UUID userId, UUID projectId) {
        try {
            // Through the self proxy, NOT a plain call: @Transactional on
            // runCliTreeIngest only takes effect when invoked via the Spring
            // proxy. A plain this.runCliTreeIngest() bypasses it (same hazard
            // the @Async dispatch above guards against), leaving no open
            // session for finishApkDecompile's lazy Project.user deref.
            self.runCliTreeIngest(userId, projectId);
        } catch (Exception e) {
            log.error("CLI tree ingest failed for project {}: {}", projectId, e.toString(), e);
            markFailed(projectId, abbreviate(e.toString()));
        }
    }

    /**
     * Transactional body of the CLI ingest — keeps the Hibernate session open
     * across {@link #finishApkDecompile} (the completion notification
     * dereferences the lazy {@code Project.user} proxy; with open-in-view off
     * and no surrounding tx it would fail). MUST be invoked through {@code
     * self} so the proxy applies the transaction.
     */
    @Transactional
    public void runCliTreeIngest(UUID userId, UUID projectId) throws IOException {
        markStartedAt(projectId);
        Path tarGz = cliTreePath(userId, projectId);
        Path out = storage.srcDir(userId, projectId);
        var result = jadx.ingestTree(tarGz, out, phase -> markPhase(projectId, phase),
                userId, projectId);
        Files.deleteIfExists(tarGz);
        finishApkDecompile(userId, projectId, result.packageName(), out);
    }

    /** APK pipeline: JADX → file tree → usage index. The original flow. */
    private void runApkDecompile(UUID userId, UUID projectId) throws IOException {
        Path apk = storage.apkPath(userId, projectId);
        Path out = storage.srcDir(userId, projectId);

        // JADX reports OPENING_APK and DECOMPILING through this callback.
        // Passing userId + projectId lets the storage layer push the
        // decompiled tree to S3 (or no-op on the fs backend).
        var result = jadx.decompile(apk, out, phase -> markPhase(projectId, phase), userId, projectId);

        finishApkDecompile(userId, projectId, result.packageName(), out);
    }

    /**
     * Shared tail of the APK pipeline — everything after a decompiled tree
     * exists in {@code out}, whether it came from the cloud worker or a CLI
     * upload: package name + READY persist, file-tree cache, usage index,
     * completion notification.
     */
    private void finishApkDecompile(UUID userId, UUID projectId, String packageName, Path out) throws IOException {
        markPhase(projectId, "BUILDING_TREE");
        var project = repo.findById(projectId)
                .orElseThrow(() -> new IllegalStateException("project disappeared: " + projectId));
        project.setPackageName(packageName);
        project.setStatus(ProjectStatus.READY);
        project.setDecompiledAt(Instant.now());

        // Pre-build + cache the file tree so the first project open is instant.
        // For a WhatsApp-sized APK this avoids ~100k stat syscalls per page load.
        try {
            Path root = out.normalize();
            FileNode tree = Files.exists(root) ? buildTree(root, root) : FileNode.dir("/", "", List.of());
            project.setFileTreeJson(mapper.writeValueAsString(tree));
        } catch (Exception e) {
            log.warn("file tree cache write failed for {}: {}", projectId, e.toString());
            project.setFileTreeJson(null);
        }
        repo.save(project);

        // Build the persistent usage index so the first call-chain / right-click
        // is fast. Done after the project is saved as READY so a failure here
        // doesn't block decompile completion — findUsages can still live-grep
        // as a fallback. Best-effort, sync-on-this-thread (which is already a
        // background @Async executor via scheduleDecompile).
        markPhase(projectId, "INDEXING_USAGES");
        try {
            usageIndexer.rebuild(userId, projectId);
        } catch (Exception e) {
            log.warn("usage index build failed for {}: {}", projectId, e.toString());
        }

        // Decompile-complete notification — best-effort, runs in REQUIRES_NEW
        // so an SES failure can't roll back the just-saved READY status. The
        // gate (user opt-out + missing email) is enforced inside the service.
        notifications.notifyDecompileComplete(project.getUser(), project);
    }

    /**
     * BIN pipeline: hand the uploaded binary to the Ghidra worker, parse the
     * metadata block, persist the raw result JSON. Per-function shredding
     * and symbol indexing come in slice 2 (disassembly view).
     */
    private void runBinaryDecompile(UUID userId, UUID projectId) throws IOException, InterruptedException {
        Path binary = storage.binaryPath(userId, projectId);
        var project = repo.findById(projectId)
                .orElseThrow(() -> new IllegalStateException("project disappeared: " + projectId));

        // BinaryDecompileService drives ANALYZING / EXTRACTING phases.
        var result = binaryDecompile.decompile(binary, project.getArch(),
                phase -> markPhase(projectId, phase));

        // The worker's metadata.arch is usually richer than the caller's hint
        // (e.g. "auto" → "x86:LE:64:default"). Prefer it when present.
        if (result.arch() != null) project.setArch(result.arch());
        project.setExecutableFormat(result.executableFormat());
        project.setCompiler(result.compiler());
        project.setLanguageId(result.languageId());
        project.setImageBase(result.imageBase());
        project.setBinaryAnalysisJson(result.rawJson());
        project.setStatus(ProjectStatus.READY);
        project.setDecompiledAt(Instant.now());
        repo.save(project);

        log.info("Ghidra decompile READY for project {} — functions={} strings={} imports={}",
                projectId, result.functionCount(), result.stringCount(), result.importCount());
    }

    /**
     * Write the current phase string to the project row. Each call is its
     * own commit — runDecompile isn't truly inside a single transaction
     * (it's invoked from {@code @Async scheduleDecompile} which bypasses the
     * @Transactional proxy via self-invocation), so each repo.save here lands
     * on disk immediately and the polling UI sees the new phase right away.
     *
     * <p>Best-effort: a phase write failure logs a warning but never
     * interrupts the decompile.
     */
    private void markPhase(UUID projectId, String phase) {
        try {
            repo.findById(projectId).ifPresent(p -> {
                p.setDecompilePhase(phase);
                repo.save(p);
            });
        } catch (Exception e) {
            log.debug("phase write failed for {} -> {}: {}", projectId, phase, e.toString());
        }
    }

    /** Initial timestamp + sentinel phase. Set once at the start so the UI's
     *  elapsed-time counter has an anchor before JADX has even said anything. */
    private void markStartedAt(UUID projectId) {
        try {
            repo.findById(projectId).ifPresent(p -> {
                p.setDecompileStartedAt(Instant.now());
                p.setDecompilePhase("STARTING");
                repo.save(p);
            });
        } catch (Exception e) {
            log.debug("decompileStartedAt write failed for {}: {}", projectId, e.toString());
        }
    }

    @Transactional
    protected void markFailed(UUID projectId, String message) {
        repo.findById(projectId).ifPresent(p -> {
            p.setStatus(ProjectStatus.FAILED);
            p.setErrorMessage(message);
            repo.save(p);
        });
    }

    @Transactional
    public ProjectResponse update(User user, UUID id, UpdateProjectRequest req) {
        var project = guard.requireEdit(user, id);
        if (req.name() != null) {
            String trimmed = req.name().trim();
            if (trimmed.isEmpty()) {
                throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "name cannot be blank");
            }
            project.setName(trimmed);
        }
        if (req.workflowStatus() != null) {
            // PUBLISHED is only reachable via the publish endpoint (it also sets publishedAt).
            if (req.workflowStatus() == WorkflowStatus.PUBLISHED) {
                throw new ResponseStatusException(HttpStatus.BAD_REQUEST,
                        "Use POST /report/publish to publish — status cannot be set to PUBLISHED directly.");
            }
            // Don't let the user drop out of PUBLISHED via PATCH — they must unpublish first.
            if (project.getWorkflowStatus() == WorkflowStatus.PUBLISHED) {
                throw new ResponseStatusException(HttpStatus.CONFLICT,
                        "Unpublish the report before changing workflow status.");
            }
            project.setWorkflowStatus(req.workflowStatus());
        }
        if (req.analysisMode() != null) {
            // Changing the mode is allowed at any time. It does NOT auto-rewrite the
            // user's existing report sections — the report's section template is
            // only seeded from this on first creation. A future "Reset to default
            // sections" button can re-seed if the user wants to start fresh.
            project.setAnalysisMode(req.analysisMode());
        }
        return ProjectResponse.from(repo.save(project), urlSigner());
    }

    /** Bump workflow forward to {@code target} if (a) current is earlier and (b) not already published. */
    @Transactional
    public void advanceWorkflowIfBefore(UUID projectId, WorkflowStatus target) {
        repo.findById(projectId).ifPresent(p -> {
            if (WorkflowStatus.shouldAdvance(p.getWorkflowStatus(), target)) {
                p.setWorkflowStatus(target);
                repo.save(p);
            }
        });
    }

    @Transactional
    public void delete(User user, UUID id) {
        // Owner-only: collaborators don't delete the project, even at
        // EDITOR. Storage path uses the OWNER's user id, which always
        // equals user.getId() here because requireOwner just enforced it.
        var project = guard.requireOwner(user, id);

        // Refcount the shared analysis blob. A fork SHARES its source's
        // binary_analysis_s3_key, so we may only delete the S3 object when
        // THIS is the last project referencing it. Count BEFORE repo.delete
        // (the row still counts) — refs <= 1 means "only me". The actual S3
        // delete runs after commit so a rolled-back delete can't destroy a
        // live blob. (This also fixes a pre-existing bug: delete never used
        // to remove the analysis blob at all, orphaning it in the bucket.)
        String blobKey = project.getBinaryAnalysisS3Key();
        long blobRefs = (blobKey != null && !blobKey.isBlank())
                ? repo.countByBinaryAnalysisS3Key(blobKey) : 0;
        Project parent = project.getForkedFrom();

        storage.deleteProject(project.getUser().getId(), project.getId());
        repo.delete(project);

        // Deleting a fork frees a slot on its source's fork_count.
        if (parent != null) {
            parent.setForkCount(Math.max(0, parent.getForkCount() - 1));
            repo.save(parent);
        }

        if (analysisStorage != null && blobKey != null && !blobKey.isBlank() && blobRefs <= 1) {
            final String key = blobKey;
            TransactionSynchronizationManager.registerSynchronization(new TransactionSynchronization() {
                @Override
                public void afterCommit() {
                    analysisStorage.deleteObject(key);
                }
            });
        }
    }

    /**
     * Fork a project: a new project owned by the caller that SHARES the
     * source's immutable analysis blob read-only and starts with an empty
     * renames/highlights/report layer ("forked from X" attribution). No worker
     * runs and no quota is charged — the fork reuses the existing analysis.
     *
     * <p>Forkable when the caller can read the source (owner/editor/viewer) OR
     * it's public. BIN-only + must be READY (its blob is finalized/ready-tagged).
     * The forker can later re-decompile via the CLI to materialize an
     * independent blob (a new key overwrites the shared pointer).
     */
    @Transactional
    public ProjectResponse fork(User caller, UUID sourceId) {
        Project source = resolveForkable(caller, sourceId);
        if (source.getKind() != ProjectKind.BIN) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST,
                    "only binary projects can be forked");
        }
        if (source.getStatus() != ProjectStatus.READY) {
            throw new ResponseStatusException(HttpStatus.CONFLICT,
                    "source analysis is not ready to fork");
        }
        boolean hasBlob = (source.getBinaryAnalysisS3Key() != null && !source.getBinaryAnalysisS3Key().isBlank())
                || (source.getBinaryAnalysisJson() != null && !source.getBinaryAnalysisJson().isBlank());
        if (!hasBlob) {
            throw new ResponseStatusException(HttpStatus.CONFLICT,
                    "source has no analysis to fork");
        }

        Project fork = new Project();
        fork.setUser(caller);
        fork.setKind(source.getKind());
        fork.setName(forkName(source.getName()));
        fork.setOriginalFilename(source.getOriginalFilename());
        fork.setSizeBytes(source.getSizeBytes());
        fork.setSha256(source.getSha256());
        fork.setArch(source.getArch());
        fork.setExecutableFormat(source.getExecutableFormat());
        fork.setCompiler(source.getCompiler());
        fork.setLanguageId(source.getLanguageId());
        fork.setImageBase(source.getImageBase());
        fork.setAnalysisMode(source.getAnalysisMode());
        // Analysis payload: legacy inline gets a row-local copy; the S3 path is
        // a SHARED pointer (refcounted on delete). Working-layer + derived
        // caches (renames/highlights/report/digest/symbol/tree) start empty.
        fork.setBinaryAnalysisJson(source.getBinaryAnalysisJson());
        fork.setBinaryAnalysisS3Key(source.getBinaryAnalysisS3Key());
        fork.setBinaryAnalysisS3Etag(source.getBinaryAnalysisS3Etag());
        fork.setBinaryAnalysisSizeBytes(source.getBinaryAnalysisSizeBytes());
        fork.setDecompiledAt(source.getDecompiledAt());
        fork.setStatus(ProjectStatus.READY);
        fork.setForkedFrom(source);
        Project saved = repo.save(fork);

        source.setForkCount(source.getForkCount() + 1);
        repo.save(source);

        return ProjectResponse.from(saved, urlSigner(), ProjectRole.OWNER);
    }

    /** A project is forkable if the caller can read it, or it's public. */
    private Project resolveForkable(User caller, UUID id) {
        try {
            return guard.requireRead(caller, id);
        } catch (ResponseStatusException e) {
            if (e.getStatusCode() == HttpStatus.NOT_FOUND) {
                return publicGuard.requirePublic(id);
            }
            throw e;
        }
    }

    private static String forkName(String sourceName) {
        String base = (sourceName == null || sourceName.isBlank()) ? "project" : sourceName;
        return base.endsWith("(fork)") ? base : base + " (fork)";
    }

    @Transactional(readOnly = true)
    public FileNode fileTree(User user, UUID id) {
        var project = guard.requireRead(user, id);
        requireReady(project);
        // Fast path: cached at decompile-time. For a WhatsApp-sized tree this
        // turns 5-15s of fs walk + serialize into a sub-100ms DB read.
        if (project.getFileTreeJson() != null && !project.getFileTreeJson().isBlank()) {
            try {
                return mapper.readValue(project.getFileTreeJson(), FileNode.class);
            } catch (Exception e) {
                log.warn("cached file tree unparseable for {}, rebuilding: {}", id, e.toString());
                // fall through to live build
            }
        }
        // Storage paths are keyed on the OWNER, not the caller. A collaborator
        // hitting this with their own user id would resolve to an empty
        // directory; always pass the project owner's id through.
        Path root = storage.srcDir(project.getUser().getId(), id).normalize();
        if (!Files.exists(root)) {
            return FileNode.dir("/", "", List.of());
        }
        FileNode tree = buildTree(root, root);
        // Lazy populate for projects from before V12, so the second open is fast.
        // Separate tx so a write failure doesn't fail the read.
        try {
            persistFileTreeCache(id, mapper.writeValueAsString(tree));
        } catch (Exception e) {
            log.debug("lazy file tree cache write failed for {}: {}", id, e.toString());
        }
        return tree;
    }

    @Transactional
    protected void persistFileTreeCache(UUID projectId, String json) {
        repo.findById(projectId).ifPresent(p -> {
            p.setFileTreeJson(json);
            repo.save(p);
        });
    }

    /**
     * Return the raw Ghidra-worker result JSON stored on a BIN project.
     * Surfaced as a String so the controller can write it through with
     * application/json content-type without re-serializing.
     *
     * <p>Caller errors are explicit so the frontend can render a useful
     * message: 400 for non-BIN projects, 409 if analysis hasn't finished,
     * 404 if the row is BIN+READY but somehow has no blob (shouldn't happen
     * after slice 1, but defensive).
     */
    @Transactional(readOnly = true)
    public String getBinaryAnalysisJson(User user, UUID id) {
        return binaryAnalysisJsonFor(guard.requireRead(user, id), id);
    }

    /**
     * Anonymous public variant — identical payload (renames applied), gated on
     * {@code public_read_at} instead of the authenticated read guard. Shares
     * {@link #binaryAnalysisJsonFor} so the public path can never diverge from
     * the authenticated one.
     */
    @Transactional(readOnly = true)
    public String getBinaryAnalysisJsonPublic(UUID id) {
        return binaryAnalysisJsonFor(publicGuard.requirePublic(id), id);
    }

    private String binaryAnalysisJsonFor(Project project, UUID id) {
        if (project.getKind() != ProjectKind.BIN) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST,
                    "not a binary project (kind=" + project.getKind() + ")");
        }
        if (project.getStatus() != ProjectStatus.READY) {
            throw new ResponseStatusException(HttpStatus.CONFLICT,
                    "analysis not ready (status=" + project.getStatus() + ")");
        }
        String json = analysisLoader.load(project);
        if (json == null || json.isBlank()) {
            throw new ResponseStatusException(HttpStatus.NOT_FOUND,
                    "no analysis stored for this project");
        }
        // Apply user-applied renames so the frontend sees a fully renamed
        // view. The BIN-aware applier handles two distinct rename scopes:
        //   - function (and any other non-variable scope) get the simple
        //     project-wide word-boundary substitution
        //   - variable renames are scoped to a single function's body via
        //     their sourcePath="function:<originalName>" tag, so Ghidra's
        //     reused placeholder names (uVar1, param_1, ...) don't mass-
        //     rewrite across the whole binary
        // The frontend stays rename-agnostic; /ask-function still works
        // because it inverse-resolves through RenameService.resolveOriginal.
        return renameService.applyMapToBinaryAnalysisJson(id, json);
    }

    /**
     * Stream the raw bytes of a file inside the project's workspace,
     * without applying the textual {@link #readFile} path's rename rewrite
     * or UTF-8 decode. Used by the openapk-frontend's "Download .so" UX
     * — the user needs the original binary to feed into local Ghidra.
     *
     * <p>Path-traversal-protected exactly like {@link #readFile}. No size
     * cap because native libraries are routinely &gt;{@code maxFileResponseBytes}
     * (which is sized for source files) and the body is streamed, not
     * buffered.
     */
    @Transactional(readOnly = true)
    public RawFile readFileRaw(User user, UUID id, String relPath) {
        var project = guard.requireRead(user, id);
        requireReady(project);

        // Owner-keyed storage path; see fileTree() comment.
        Path root = storage.srcDir(project.getUser().getId(), id).normalize();
        Path resolved = root.resolve(relPath).normalize();
        if (!resolved.startsWith(root)) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "path escapes project root");
        }
        if (!Files.isRegularFile(resolved)) {
            throw new ResponseStatusException(HttpStatus.NOT_FOUND, "not a regular file");
        }
        try {
            long size = Files.size(resolved);
            String filename = resolved.getFileName().toString();
            // Caller closes the stream. Spring's InputStreamResource handles
            // this when used as a ResponseEntity body.
            InputStream stream = Files.newInputStream(resolved);
            return new RawFile(filename, size, stream);
        } catch (IOException e) {
            throw new ResponseStatusException(HttpStatus.INTERNAL_SERVER_ERROR, "read failed: " + e.getMessage());
        }
    }

    public record RawFile(String filename, long sizeBytes, InputStream body) {}

    @Transactional(readOnly = true)
    public FileContentResponse readFile(User user, UUID id, String relPath) {
        var project = guard.requireRead(user, id);
        requireReady(project);

        // Owner-keyed storage path; see fileTree() comment.
        Path root = storage.srcDir(project.getUser().getId(), id).normalize();
        Path resolved = root.resolve(relPath).normalize();
        if (!resolved.startsWith(root)) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "path escapes project root");
        }
        if (!Files.isRegularFile(resolved)) {
            throw new ResponseStatusException(HttpStatus.NOT_FOUND, "not a regular file");
        }

        long size;
        byte[] bytes;
        try {
            size = Files.size(resolved);
            long max = props.projects().maxFileResponseBytes();
            boolean truncated = size > max;
            try (InputStream in = Files.newInputStream(resolved)) {
                bytes = in.readNBytes((int) Math.min(size, max));
            }
            String encoding;
            String content;
            if (looksTextual(bytes)) {
                content = new String(bytes, StandardCharsets.UTF_8);
                // Apply project's accepted renames so the API + AI agents see the
                // user's deobfuscated names everywhere.
                content = renameService.applyMapToContent(id, content);
                encoding = "utf-8";
            } else {
                content = "";
                encoding = "binary";
            }
            return new FileContentResponse(relPath, size, truncated, encoding, content);
        } catch (IOException e) {
            throw new ResponseStatusException(HttpStatus.INTERNAL_SERVER_ERROR, "read failed: " + e.getMessage());
        }
    }

    private FileNode buildTree(Path root, Path current) {
        String name = current.equals(root) ? "/" : current.getFileName().toString();
        String relPath = root.relativize(current).toString();
        try (Stream<Path> stream = Files.list(current)) {
            var entries = stream
                    .sorted(Comparator.comparing(
                            (Path p) -> !Files.isDirectory(p))
                            .thenComparing(p -> p.getFileName().toString().toLowerCase()))
                    .toList();
            List<FileNode> children = new ArrayList<>(entries.size());
            for (Path p : entries) {
                if (Files.isDirectory(p)) {
                    children.add(buildTree(root, p));
                } else {
                    try {
                        children.add(FileNode.file(
                                p.getFileName().toString(),
                                root.relativize(p).toString(),
                                Files.size(p)
                        ));
                    } catch (IOException e) {
                        log.debug("skip {}: {}", p, e.toString());
                    }
                }
            }
            return FileNode.dir(name, relPath, children);
        } catch (IOException e) {
            log.warn("Failed to list {}: {}", current, e.toString());
            return FileNode.dir(name, relPath, List.of());
        }
    }

    private boolean looksTextual(byte[] bytes) {
        int len = Math.min(bytes.length, 8192);
        int suspicious = 0;
        for (int i = 0; i < len; i++) {
            int b = bytes[i] & 0xFF;
            if (b == 0) return false;
            if (b < 0x09 || (b > 0x0D && b < 0x20 && b != 0x1B)) suspicious++;
        }
        return suspicious * 100 / Math.max(1, len) < 5;
    }

    private void requireReady(Project p) {
        if (p.getStatus() != ProjectStatus.READY) {
            throw new ResponseStatusException(HttpStatus.CONFLICT,
                    "project is not READY (current status: " + p.getStatus() + ")");
        }
    }

    private static String sanitizeFilename(String name, ProjectKind kind) {
        String fallback = kind == ProjectKind.BIN ? "upload.bin" : "upload.apk";
        if (name == null || name.isBlank()) return fallback;
        // Strip path components and control chars.
        String base = name.replaceAll(".*[/\\\\]", "").replaceAll("[\\x00-\\x1F]", "_");
        return base.isBlank() ? fallback : base;
    }

    /**
     * Sniff the first 4 bytes to pick a kind when the caller didn't specify.
     * Used only as a fallback — openapk.ai and openbin.ai both pass an
     * explicit kind via the upload form. Defaults to APK for unknowns so the
     * pre-OpenBin upload path keeps working unchanged.
     */
    private static ProjectKind sniffKind(MultipartFile file) {
        byte[] buf;
        try (InputStream in = file.getInputStream()) {
            buf = in.readNBytes(4);
        } catch (IOException e) {
            return ProjectKind.APK;
        }
        if (buf.length < 4) return ProjectKind.APK;
        // PK\x03\x04 — ZIP / APK / JAR
        if (buf[0] == 0x50 && buf[1] == 0x4B && buf[2] == 0x03 && buf[3] == 0x04) return ProjectKind.APK;
        // \x7FELF
        if ((buf[0] & 0xFF) == 0x7F && buf[1] == 'E' && buf[2] == 'L' && buf[3] == 'F') return ProjectKind.BIN;
        // MZ — DOS/PE
        if (buf[0] == 'M' && buf[1] == 'Z') return ProjectKind.BIN;
        // Mach-O magics: 32/64-bit BE/LE + fat-binary
        int magic = ((buf[0] & 0xFF) << 24) | ((buf[1] & 0xFF) << 16) | ((buf[2] & 0xFF) << 8) | (buf[3] & 0xFF);
        if (magic == 0xFEEDFACE || magic == 0xFEEDFACF
                || magic == 0xCEFAEDFE || magic == 0xCFFAEDFE
                || magic == 0xCAFEBABE) {
            return ProjectKind.BIN;
        }
        return ProjectKind.APK;
    }

    private static String abbreviate(String s) {
        if (s == null) return "unknown error";
        return s.length() > 500 ? s.substring(0, 500) + "…" : s;
    }
}
