package ai.openapk.core.callchain;

import ai.openapk.core.auth.CurrentUserService;
import ai.openapk.core.callchain.dto.BuildChainRequest;
import ai.openapk.core.callchain.dto.CallChain;
import ai.openapk.core.callchain.dto.NarrateBinChainRequest;
import ai.openapk.core.callchain.dto.NarrateBinChainResponse;
import ai.openapk.core.callchain.dto.NarrateChainRequest;
import jakarta.validation.Valid;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.util.UUID;

@RestController
@RequestMapping("/api/projects/{id}/callchains")
public class CallChainController {

    private final CallChainService service;
    private final CurrentUserService currentUser;

    public CallChainController(CallChainService service, CurrentUserService currentUser) {
        this.service = service;
        this.currentUser = currentUser;
    }

    @PostMapping("/build")
    public CallChain build(@PathVariable("id") UUID id, @Valid @RequestBody BuildChainRequest req) {
        return service.build(currentUser.current(), id, req.file(), req.line(), req.depth(), req.includeSdks());
    }

    @PostMapping("/narrate")
    public CallChain narrate(@PathVariable("id") UUID id, @Valid @RequestBody NarrateChainRequest req) {
        return service.narrate(currentUser.current(), id, req.chain(), req.credentialId(), req.model());
    }

    /**
     * BIN-only narrate. Takes a flat list of function names (the openbin
     * chain is built client-side from xrefs) and returns one-sentence
     * summaries keyed by name.
     */
    @PostMapping("/narrate-bin")
    public NarrateBinChainResponse narrateBin(
            @PathVariable("id") UUID id,
            @Valid @RequestBody NarrateBinChainRequest req
    ) {
        return service.narrateBin(currentUser.current(), id,
                req.functionNames(), req.credentialId(), req.model());
    }
}
