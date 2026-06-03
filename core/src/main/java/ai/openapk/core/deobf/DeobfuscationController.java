package ai.openapk.core.deobf;

import ai.openapk.core.auth.CurrentUserService;
import ai.openapk.core.deobf.dto.DeobfuscateFunctionRequest;
import ai.openapk.core.deobf.dto.FunctionDeobfuscationResponse;
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
@RequestMapping("/api/projects/{id}/deobfuscations")
public class DeobfuscationController {

    private final DeobfuscationService service;
    private final CurrentUserService currentUser;

    public DeobfuscationController(DeobfuscationService service, CurrentUserService currentUser) {
        this.service = service;
        this.currentUser = currentUser;
    }

    /** Project-wide deobf cache so ProjectView can paint the "Deobf" tab as
     *  pre-populated for any function the user has previously deobfuscated. */
    @GetMapping
    public List<FunctionDeobfuscationResponse> list(@PathVariable("id") UUID id) {
        return service.list(currentUser.current(), id);
    }

    /** Generate (or regenerate) a deobf for one function. Upserts on
     *  (project, original_name) so re-running just overwrites. */
    @PostMapping
    public FunctionDeobfuscationResponse generate(
            @PathVariable("id") UUID id,
            @Valid @RequestBody DeobfuscateFunctionRequest req
    ) {
        return service.generate(currentUser.current(), id, req);
    }

    @DeleteMapping
    public void delete(
            @PathVariable("id") UUID id,
            @RequestParam("functionName") String functionName
    ) {
        service.delete(currentUser.current(), id, functionName);
    }
}
