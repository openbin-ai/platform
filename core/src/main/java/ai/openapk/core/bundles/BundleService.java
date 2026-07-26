package ai.openapk.core.bundles;

import ai.openapk.core.auth.User;
import ai.openapk.core.bundles.dto.BundleDetail;
import ai.openapk.core.bundles.dto.BundleSummary;
import ai.openapk.core.projects.Project;
import ai.openapk.core.projects.ProjectRepository;
import ai.openapk.core.projects.ProjectRole;
import ai.openapk.core.projects.ProjectService;
import ai.openapk.core.projects.dto.ProjectResponse;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.server.ResponseStatusException;

import java.util.List;
import java.util.UUID;

/**
 * Owns the bundle lifecycle: list / open / rename / delete, plus the get-or-
 * create the CLI uses to tag a sweep's files. Bundles are strictly owner-scoped
 * in v1 (no sharing) — every method resolves through {@link #requireOwner} so a
 * bundle id can't be read or mutated across accounts.
 *
 * <p>Deletion is DESTRUCTIVE by design (product decision 2026-07-26): removing a
 * bundle removes every member project, reusing {@link ProjectService#delete} per
 * member so each one's storage + shared-analysis-blob refcount cleanup runs
 * exactly as a standalone delete would. The web app guards this behind a
 * count-naming confirm.
 */
@Service
public class BundleService {

    private static final Logger log = LoggerFactory.getLogger(BundleService.class);

    private final BundleRepository bundleRepo;
    private final ProjectRepository projectRepo;
    private final ProjectService projectService;

    public BundleService(BundleRepository bundleRepo,
                         ProjectRepository projectRepo,
                         ProjectService projectService) {
        this.bundleRepo = bundleRepo;
        this.projectRepo = projectRepo;
        this.projectService = projectService;
    }

    @Transactional(readOnly = true)
    public List<BundleSummary> list(User user) {
        return bundleRepo.findAllByUserIdOrderByCreatedAtDesc(user.getId()).stream()
                .map(this::toSummary)
                .toList();
    }

    @Transactional(readOnly = true)
    public BundleDetail get(User user, UUID id) {
        Bundle bundle = requireOwner(user, id);
        // Members in add-order (created_at ASC) so the overview list and the
        // ProjectView tab bar render the files left-to-right in the same order.
        // No URL signer: the overview shows metadata only; the signed analysis
        // URL is minted when the user opens an individual file's ProjectView.
        List<ProjectResponse> files = projectRepo
                .findAllByBundleIdOrderByCreatedAtAsc(id).stream()
                .map(p -> ProjectResponse.from(p, null, ProjectRole.OWNER))
                .toList();
        return new BundleDetail(bundle.getId(), bundle.getName(), bundle.getCreatedAt(), files);
    }

    /**
     * Get-or-create a bundle by exact name for this user. Idempotent by design
     * so re-running {@code openbin decompile ./dir} (or the same --bundle NAME)
     * appends to the existing bundle instead of spawning duplicates.
     */
    @Transactional
    public BundleSummary getOrCreate(User user, String rawName) {
        String name = rawName == null ? "" : rawName.trim();
        if (name.isEmpty()) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "bundle name cannot be blank");
        }
        Bundle bundle = bundleRepo
                .findFirstByUserIdAndNameOrderByCreatedAtAsc(user.getId(), name)
                .orElseGet(() -> {
                    Bundle b = new Bundle();
                    b.setUser(user);
                    b.setName(name);
                    return bundleRepo.save(b);
                });
        return toSummary(bundle);
    }

    @Transactional
    public BundleSummary rename(User user, UUID id, String rawName) {
        Bundle bundle = requireOwner(user, id);
        String name = rawName == null ? "" : rawName.trim();
        if (name.isEmpty()) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "bundle name cannot be blank");
        }
        bundle.setName(name);
        return toSummary(bundleRepo.save(bundle));
    }

    /**
     * Delete the bundle AND every member project (destructive — see class doc).
     * Members are removed via {@link ProjectService#delete} so per-project
     * storage + shared-blob refcounting runs; the last member's delete auto-
     * removes the now-empty bundle (see ProjectService), so we only need to
     * sweep up a bundle that had no members to begin with.
     */
    @Transactional
    public void delete(User user, UUID id) {
        requireOwner(user, id);
        List<Project> members = projectRepo.findAllByBundleIdOrderByCreatedAtAsc(id);
        for (Project m : members) {
            projectService.delete(user, m.getId());
        }
        // Empty-bundle case (no members ever ingested): remove it directly.
        // When members existed, the last projectService.delete already dropped
        // the bundle, so this re-fetch finds nothing and no-ops.
        bundleRepo.findByIdAndUserId(id, user.getId()).ifPresent(bundleRepo::delete);
        log.info("bundle deleted: user={} bundle={} members={}", user.getId(), id, members.size());
    }

    /**
     * Owner-scoped resolve used by every public method AND by the ingest path
     * when it attaches a freshly-decompiled project to a bundle. Returns the
     * managed entity so callers can point a project at it.
     */
    @Transactional(readOnly = true)
    public Bundle requireOwner(User user, UUID id) {
        return bundleRepo.findByIdAndUserId(id, user.getId())
                .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND, "bundle not found"));
    }

    private BundleSummary toSummary(Bundle b) {
        int count = (int) projectRepo.countByBundleId(b.getId());
        return new BundleSummary(b.getId(), b.getName(), b.getCreatedAt(), count);
    }
}
