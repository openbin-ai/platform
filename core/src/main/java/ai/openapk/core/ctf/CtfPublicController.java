package ai.openapk.core.ctf;

import ai.openapk.core.auth.CurrentUserService;
import ai.openapk.core.ctf.dto.CtfDtos.ChallengeDetail;
import ai.openapk.core.ctf.dto.CtfDtos.ChallengeSummary;
import ai.openapk.core.ctf.dto.CtfDtos.CtfHome;
import ai.openapk.core.ctf.dto.CtfDtos.Leaderboard;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import java.util.List;

/**
 * Anonymous-readable CTF surface (under /api/public/**, which SecurityConfig
 * permits). Signed-in viewers still send their token, so responses can
 * carry the viewer's own solve.
 */
@RestController
@RequestMapping("/api/public/ctf")
public class CtfPublicController {

    private final CtfService service;
    private final CurrentUserService currentUser;

    public CtfPublicController(CtfService service, CurrentUserService currentUser) {
        this.service = service;
        this.currentUser = currentUser;
    }

    @GetMapping
    public CtfHome home() {
        return service.home(currentUser.currentOrNull());
    }

    @GetMapping("/challenges")
    public List<ChallengeSummary> archive() {
        return service.archive();
    }

    @GetMapping("/challenges/{slug}")
    public ChallengeDetail get(@PathVariable String slug) {
        return service.get(slug, currentUser.currentOrNull());
    }

    @GetMapping("/leaderboard")
    public Leaderboard leaderboard(@RequestParam(defaultValue = "season") String scope,
                                   @RequestParam(required = false) String season) {
        return service.leaderboard(scope, season);
    }
}
