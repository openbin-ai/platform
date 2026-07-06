package ai.openapk.core.web;

import ai.openapk.core.auth.CurrentUserService;
import ai.openapk.core.auth.User;
import ai.openapk.core.auth.UserRepository;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PatchMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.util.LinkedHashMap;
import java.util.Map;

@RestController
@RequestMapping("/api/me")
public class MeController {

    private final CurrentUserService currentUser;
    private final UserRepository userRepo;

    public MeController(CurrentUserService currentUser, UserRepository userRepo) {
        this.currentUser = currentUser;
        this.userRepo = userRepo;
    }

    @GetMapping
    public Map<String, Object> me() {
        return toResponse(currentUser.current());
    }

    /**
     * Update the caller's own preferences. Currently just the public-credit
     * opt-out; PATCH semantics mean an absent field leaves the value alone.
     */
    @PatchMapping
    @Transactional
    public Map<String, Object> update(@RequestBody UpdateMeRequest req) {
        User u = currentUser.current();
        if (req.creditPublicly() != null) {
            u.setCreditPublicly(req.creditPublicly());
            u = userRepo.save(u);
        }
        return toResponse(u);
    }

    private Map<String, Object> toResponse(User u) {
        var out = new LinkedHashMap<String, Object>();
        out.put("id", u.getId());
        out.put("email", u.getEmail());
        out.put("displayName", u.getDisplayName());
        out.put("keycloakSub", u.getKeycloakSub());
        out.put("creditPublicly", u.isCreditPublicly());
        return out;
    }

    public record UpdateMeRequest(Boolean creditPublicly) {}
}
