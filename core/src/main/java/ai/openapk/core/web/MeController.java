package ai.openapk.core.web;

import ai.openapk.core.auth.CurrentUserService;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.util.LinkedHashMap;
import java.util.Map;

@RestController
@RequestMapping("/api/me")
public class MeController {

    private final CurrentUserService currentUser;

    public MeController(CurrentUserService currentUser) {
        this.currentUser = currentUser;
    }

    @GetMapping
    public Map<String, Object> me() {
        var u = currentUser.current();
        var out = new LinkedHashMap<String, Object>();
        out.put("id", u.getId());
        out.put("email", u.getEmail());
        out.put("displayName", u.getDisplayName());
        out.put("keycloakSub", u.getKeycloakSub());
        return out;
    }
}
