package ai.openapk.core.bundles;

import ai.openapk.core.auth.CurrentUserService;
import ai.openapk.core.bundles.dto.BundleDetail;
import ai.openapk.core.bundles.dto.BundleSummary;
import ai.openapk.core.bundles.dto.CreateBundleRequest;
import ai.openapk.core.bundles.dto.RenameBundleRequest;
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
 * Bundle CRUD for both the web app (list / open / rename / delete) and the CLI
 * (get-or-create by name before a sweep). Owner-scoped throughout.
 */
@RestController
@RequestMapping("/api/bundles")
public class BundleController {

    private final BundleService service;
    private final CurrentUserService currentUser;

    public BundleController(BundleService service, CurrentUserService currentUser) {
        this.service = service;
        this.currentUser = currentUser;
    }

    /** Owner's bundles, newest first — the dashboard grouping source. */
    @GetMapping
    public List<BundleSummary> list() {
        return service.list(currentUser.current());
    }

    /** Full overview payload (identity + member files). */
    @GetMapping("/{id}")
    public BundleDetail get(@PathVariable UUID id) {
        return service.get(currentUser.current(), id);
    }

    /**
     * Get-or-create a bundle by name. The CLI hits this before ingesting a
     * sweep's files; re-runs are idempotent (append to the existing bundle).
     */
    @PostMapping
    @ResponseStatus(HttpStatus.CREATED)
    public BundleSummary create(@Valid @RequestBody CreateBundleRequest req) {
        return service.getOrCreate(currentUser.current(), req.name());
    }

    @PatchMapping("/{id}")
    public BundleSummary rename(@PathVariable UUID id, @Valid @RequestBody RenameBundleRequest req) {
        return service.rename(currentUser.current(), id, req.name());
    }

    /** DESTRUCTIVE: deletes the bundle AND every member project. Owner-only. */
    @DeleteMapping("/{id}")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    public void delete(@PathVariable UUID id) {
        service.delete(currentUser.current(), id);
    }
}
