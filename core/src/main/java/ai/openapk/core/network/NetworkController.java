package ai.openapk.core.network;

import ai.openapk.core.auth.CurrentUserService;
import ai.openapk.core.network.dto.NetworkHit;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import java.util.List;
import java.util.UUID;

@RestController
@RequestMapping("/api/projects/{id}/network")
public class NetworkController {

    private final NetworkService service;
    private final CurrentUserService currentUser;

    public NetworkController(NetworkService service, CurrentUserService currentUser) {
        this.service = service;
        this.currentUser = currentUser;
    }

    @GetMapping
    public List<NetworkHit> scan(
            @PathVariable("id") UUID id,
            @RequestParam(value = "includeSdks", defaultValue = "false") boolean includeSdks
    ) {
        return service.scan(currentUser.current(), id, includeSdks);
    }
}
