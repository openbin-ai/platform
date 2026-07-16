package ai.openapk.core.credentials;

import ai.openapk.core.auth.CurrentUserService;
import ai.openapk.core.credentials.dto.CreateCredentialRequest;
import ai.openapk.core.credentials.dto.CredentialResponse;
import ai.openapk.core.credentials.dto.TestResultResponse;
import jakarta.validation.Valid;
import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;

import java.util.List;
import java.util.UUID;

@RestController
@RequestMapping("/api/credentials")
public class LlmCredentialController {

    private final LlmCredentialService service;
    private final CurrentUserService currentUser;

    public LlmCredentialController(LlmCredentialService service, CurrentUserService currentUser) {
        this.service = service;
        this.currentUser = currentUser;
    }

    @GetMapping
    public List<CredentialResponse> list() {
        return service.list(currentUser.current());
    }

    @PostMapping
    @ResponseStatus(HttpStatus.CREATED)
    public CredentialResponse create(@Valid @RequestBody CreateCredentialRequest req) {
        return service.create(currentUser.current(), req);
    }

    @DeleteMapping("/{id}")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    public void delete(@PathVariable UUID id) {
        service.delete(currentUser.current(), id);
    }

    @PostMapping("/{id}/test")
    public TestResultResponse test(@PathVariable UUID id) {
        return service.test(currentUser.current(), id);
    }

    /**
     * Live model IDs available to this credential (queried from the provider +
     * cached). The model picker populates from here instead of a hardcoded list.
     */
    @GetMapping("/{id}/models")
    public List<String> models(@PathVariable UUID id) {
        return service.listModels(currentUser.current(), id);
    }
}
