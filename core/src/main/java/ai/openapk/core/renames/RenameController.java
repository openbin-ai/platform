package ai.openapk.core.renames;

import ai.openapk.core.auth.CurrentUserService;
import ai.openapk.core.renames.dto.ApplyRenamesRequest;
import ai.openapk.core.renames.dto.ManualRenameRequest;
import ai.openapk.core.renames.dto.RenameDto;
import ai.openapk.core.renames.dto.SuggestFunctionRenamesRequest;
import ai.openapk.core.renames.dto.SuggestRenamesRequest;
import ai.openapk.core.renames.dto.SuggestRenamesResponse;
import jakarta.validation.Valid;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import java.util.List;
import java.util.UUID;

@RestController
@RequestMapping("/api/projects/{id}/renames")
public class RenameController {

    private final RenameService service;
    private final CurrentUserService currentUser;

    public RenameController(RenameService service, CurrentUserService currentUser) {
        this.service = service;
        this.currentUser = currentUser;
    }

    @GetMapping
    public List<RenameDto> list(@PathVariable("id") UUID id) {
        return service.list(currentUser.current(), id);
    }

    @PostMapping("/suggest")
    public SuggestRenamesResponse suggest(@PathVariable("id") UUID id, @Valid @RequestBody SuggestRenamesRequest req) {
        return service.suggest(currentUser.current(), id, req);
    }

    /**
     * BIN-only: suggest names for one function — the function itself plus
     * its parameters and locals. Persists results as SUGGESTED rows tagged
     * with {@code sourcePath="function:<originalName>"} so variable
     * suggestions stay scoped to that function's body when applied.
     */
    @PostMapping("/suggest-function")
    public SuggestRenamesResponse suggestFunction(
            @PathVariable("id") UUID id,
            @Valid @RequestBody SuggestFunctionRenamesRequest req
    ) {
        return service.suggestForFunction(currentUser.current(), id, req);
    }

    @PostMapping("/apply")
    public List<RenameDto> apply(@PathVariable("id") UUID id, @Valid @RequestBody ApplyRenamesRequest req) {
        return service.apply(currentUser.current(), id, req);
    }

    /**
     * Manually create-and-apply a rename in one shot. Used by the OpenBin
     * function-rename UI where the user types a new name directly — there's
     * no SUGGESTED middle state to flip through. Upserts on
     * {@code (project_id, original)}: if a row exists it gets the new
     * suggested name + flipped to APPLIED; otherwise a new APPLIED row is
     * created. Works for either kind, but BIN is the primary caller.
     */
    @PostMapping("/manual")
    public RenameDto manualRename(@PathVariable("id") UUID id, @Valid @RequestBody ManualRenameRequest req) {
        return service.manualRename(currentUser.current(), id, req);
    }

    @DeleteMapping
    public void unapply(@PathVariable("id") UUID id, @RequestParam("original") String original) {
        service.unapply(currentUser.current(), id, original);
    }
}
