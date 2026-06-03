package ai.openapk.core.nativeanalysis;

import ai.openapk.core.auth.User;
import ai.openapk.core.nativeanalysis.dto.NativeLibraryView;
import ai.openapk.core.projects.ProjectRepository;
import ai.openapk.core.projects.storage.ProjectStorage;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.server.ResponseStatusException;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.Iterator;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.stream.Stream;

/**
 * Discovers native libraries in a project's JADX-extracted resources tree
 * and orchestrates per-{@code .so} Ghidra analysis jobs.
 *
 * <p>JADX writes resources to {@code <srcDir>/resources/lib/<abi>/*.so} when
 * {@code skipResources=false}, which we always set (see
 * {@link ai.openapk.core.projects.JadxDecompileService}). The {@code <abi>}
 * directory names are the standard Android ABIs:
 * {@code arm64-v8a, armeabi-v7a, x86_64, x86}.
 *
 * <p>One {@link NativeAnalysis} row exists per (project, libPath). Kicking off
 * an analysis flips status to {@code PENDING}, then {@link NativeAnalysisRunner}
 * (a separate bean so {@code @Async} actually fires) moves it through
 * {@code RUNNING} → {@code READY}/{@code FAILED} on the
 * {@code nativeAnalysisExecutor} pool.
 */
@Service
public class NativeAnalysisService {

    private static final Logger log = LoggerFactory.getLogger(NativeAnalysisService.class);

    /**
     * Relative path under srcDir where JADX dumps the bundled native libs.
     * Direct walk of this subtree is enough — we don't scan for stray .so
     * files outside it.
     */
    private static final String NATIVE_LIB_ROOT = "resources/lib";

    private final ProjectRepository projectRepo;
    private final NativeAnalysisRepository nativeRepo;
    private final ProjectStorage storage;
    private final NativeAnalysisRunner runner;

    public NativeAnalysisService(
            ProjectRepository projectRepo,
            NativeAnalysisRepository nativeRepo,
            ProjectStorage storage,
            NativeAnalysisRunner runner
    ) {
        this.projectRepo = projectRepo;
        this.nativeRepo = nativeRepo;
        this.storage = storage;
        this.runner = runner;
    }

    /**
     * List every {@code .so} under {@code resources/lib/<abi>/} for this project,
     * joined with persisted job status (status / errorMessage / analyzedAt
     * null when never analyzed).
     */
    @Transactional(readOnly = true)
    public List<NativeLibraryView> listLibraries(User user, UUID projectId) {
        requireOwned(user, projectId);
        Path root = storage.srcDir(user.getId(), projectId).normalize();
        Path libRoot = root.resolve(NATIVE_LIB_ROOT);
        if (!Files.isDirectory(libRoot)) return List.of();

        Map<String, NativeAnalysis> persisted = new HashMap<>();
        for (NativeAnalysis na : nativeRepo.findAllByProjectId(projectId)) {
            persisted.put(na.getLibPath(), na);
        }

        List<NativeLibraryView> out = new ArrayList<>();
        try (Stream<Path> walk = Files.walk(libRoot, 3)) {
            Iterator<Path> it = walk.filter(Files::isRegularFile)
                    .filter(p -> p.getFileName().toString().endsWith(".so"))
                    .iterator();
            while (it.hasNext()) {
                Path p = it.next();
                String rel = root.relativize(p).toString().replace('\\', '/');
                String arch = inferArch(rel);
                long size;
                try { size = Files.size(p); } catch (IOException e) { size = -1L; }
                NativeAnalysis row = persisted.get(rel);
                out.add(new NativeLibraryView(
                        rel,
                        arch,
                        size,
                        row != null ? row.getStatus() : null,
                        row != null ? row.getErrorMessage() : null,
                        row != null ? row.getAnalyzedAt() : null
                ));
            }
        } catch (IOException e) {
            log.warn("native lib walk failed under {}: {}", libRoot, e.toString());
        }
        out.sort((a, b) -> {
            int byArch = a.arch().compareTo(b.arch());
            if (byArch != 0) return byArch;
            return a.libPath().compareTo(b.libPath());
        });
        return out;
    }

    /**
     * Get the persisted full result blob for one (project, libPath).
     * Returns null when status is not yet {@code READY}.
     */
    @Transactional(readOnly = true)
    public String getResultJson(User user, UUID projectId, String libPath) {
        requireOwned(user, projectId);
        validateLibPath(user, projectId, libPath);
        return nativeRepo.findByProjectIdAndLibPath(projectId, libPath)
                .filter(na -> na.getStatus() == NativeAnalysisStatus.READY)
                .map(NativeAnalysis::getResultJson)
                .orElse(null);
    }

    /**
     * Insert (or reset) the analysis row to {@code PENDING} and hand off to
     * the async runner. Idempotent — re-kicking an already in-flight job is a
     * no-op (returns the current view); a concurrent insert race for the
     * same (project, libPath) is caught and resolved to the winning row.
     */
    @Transactional
    public NativeLibraryView kickoff(User user, UUID projectId, String libPath) {
        requireOwned(user, projectId);
        Path absLib = validateLibPath(user, projectId, libPath);
        long size;
        try { size = Files.size(absLib); }
        catch (IOException e) { throw new ResponseStatusException(HttpStatus.NOT_FOUND, "lib not readable"); }

        var existing = nativeRepo.findByProjectIdAndLibPath(projectId, libPath).orElse(null);
        if (existing != null && isInFlight(existing.getStatus())) {
            // Already in flight. Surface the current view rather than enqueueing again.
            return toView(libPath, inferArch(libPath), size, existing);
        }

        NativeAnalysis row = existing != null ? existing : new NativeAnalysis();
        row.setProjectId(projectId);
        row.setLibPath(libPath);
        row.setArch(inferArch(libPath));
        row.setSizeBytes(size);
        row.setStatus(NativeAnalysisStatus.PENDING);
        row.setResultJson(null);
        row.setErrorMessage(null);
        row.setAnalyzedAt(null);

        try {
            row = nativeRepo.saveAndFlush(row);
        } catch (DataIntegrityViolationException race) {
            // A concurrent kickoff for the same (project, libPath) won the
            // INSERT race. Re-load and surface the winner — don't double-dispatch.
            log.info("kickoff race for project {} lib {} — re-loading winner",
                    projectId, libPath);
            row = nativeRepo.findByProjectIdAndLibPath(projectId, libPath)
                    .orElseThrow(() -> race);
            return toView(libPath, inferArch(libPath), size, row);
        }

        // Hand off to the @Async runner. This call goes through the proxy
        // because runner is a separate bean — kickoff returns immediately.
        runner.run(user.getId(), projectId, libPath, row.getArch());
        return toView(libPath, row.getArch(), row.getSizeBytes(), row);
    }

    // ---------- helpers ----------

    private static boolean isInFlight(NativeAnalysisStatus s) {
        return s == NativeAnalysisStatus.PENDING || s == NativeAnalysisStatus.RUNNING;
    }

    private void requireOwned(User user, UUID projectId) {
        projectRepo.findByIdAndUserId(projectId, user.getId())
                .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND, "project not found"));
    }

    /**
     * Resolve {@code libPath} against the project's srcDir and make sure
     * the result stays inside it AND points to an .so under resources/lib.
     */
    private Path validateLibPath(User user, UUID projectId, String libPath) {
        if (libPath == null || libPath.isBlank()) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "libPath is required");
        }
        Path root = storage.srcDir(user.getId(), projectId).normalize();
        Path resolved = root.resolve(libPath).normalize();
        if (!resolved.startsWith(root)) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "libPath escapes project root");
        }
        Path libRoot = root.resolve(NATIVE_LIB_ROOT).normalize();
        if (!resolved.startsWith(libRoot)) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST,
                    "libPath must point inside " + NATIVE_LIB_ROOT);
        }
        if (!resolved.getFileName().toString().endsWith(".so")) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "not a .so file");
        }
        return resolved;
    }

    private static String inferArch(String relPath) {
        // resources/lib/<abi>/<libname>.so
        String[] parts = relPath.split("/");
        if (parts.length >= 4 && "resources".equals(parts[0]) && "lib".equals(parts[1])) {
            return parts[2];
        }
        return "unknown";
    }

    private static NativeLibraryView toView(String libPath, String arch, long size, NativeAnalysis row) {
        return new NativeLibraryView(libPath, arch, size, row.getStatus(),
                row.getErrorMessage(), row.getAnalyzedAt());
    }
}
