package ai.openapk.core.symbols;

import ai.openapk.core.auth.CurrentUserService;
import ai.openapk.core.symbols.dto.Symbol;
import ai.openapk.core.symbols.dto.SymbolIndex;
import ai.openapk.core.symbols.dto.SymbolUsage;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import java.util.List;
import java.util.UUID;

@RestController
@RequestMapping("/api/projects/{id}/symbols")
public class SymbolController {

    private final SymbolService service;
    private final CurrentUserService currentUser;

    public SymbolController(SymbolService service, CurrentUserService currentUser) {
        this.service = service;
        this.currentUser = currentUser;
    }

    /** Lazy fetch: builds the index on first call. Used by debug / status UI. */
    @GetMapping
    public SymbolIndex index(@PathVariable("id") UUID id) {
        return service.getOrBuild(currentUser.current(), id);
    }

    @PostMapping("/rebuild")
    public SymbolIndex rebuild(@PathVariable("id") UUID id) {
        return service.rebuild(currentUser.current(), id);
    }

    /** All declarations matching {@code name}. Multiple results when the name is a homonym. */
    @GetMapping("/definition")
    public List<Symbol> definition(
            @PathVariable("id") UUID id,
            @RequestParam("name") String name,
            @RequestParam(value = "includeSdks", defaultValue = "false") boolean includeSdks
    ) {
        return service.findDefinitions(currentUser.current(), id, name, includeSdks);
    }

    /**
     * Callsites / references to {@code name}. Optional {@code class} narrows to
     * "{class}.{name}" callsite patterns. {@code excludeFile}+{@code excludeLine}
     * suppress the declaration row when the caller knows it.
     */
    @GetMapping("/usages")
    public List<SymbolUsage> usages(
            @PathVariable("id") UUID id,
            @RequestParam("name") String name,
            @RequestParam(value = "class", required = false) String qualifyingClass,
            @RequestParam(value = "excludeFile", required = false) String excludeFile,
            @RequestParam(value = "excludeLine", required = false, defaultValue = "0") int excludeLine,
            @RequestParam(value = "includeSdks", defaultValue = "false") boolean includeSdks
    ) {
        return service.findUsages(currentUser.current(), id, name, qualifyingClass, excludeFile, excludeLine, includeSdks);
    }
}
