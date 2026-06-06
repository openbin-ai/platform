package ai.openapk.core.social;

import ai.openapk.core.auth.CurrentUserService;
import ai.openapk.core.projects.ProjectKind;
import ai.openapk.core.reports.dto.CommunityReportSummary;
import ai.openapk.core.social.dto.ToggleResponse;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import java.util.List;
import java.util.UUID;

/**
 * Authenticated social-layer endpoints. {@code /api/social/**} is gated
 * by the default {@code authenticated()} matcher in
 * {@link ai.openapk.core.config.SecurityConfig} — no extra config needed.
 *
 * <p>Public author profiles are also served here even though they're
 * anonymous-readable; gating happens at the action level (only follow
 * state + private fields are personalized). The path is more discoverable
 * here than alongside the community feed.
 */
@RestController
@RequestMapping("/api/social")
public class SocialController {

    private final SocialService social;
    private final CurrentUserService currentUser;

    public SocialController(SocialService social, CurrentUserService currentUser) {
        this.social = social;
        this.currentUser = currentUser;
    }

    // ─── follows ────────────────────────────────────────────────────────

    @PostMapping("/follows/{userId}")
    public ToggleResponse follow(@PathVariable("userId") UUID userId) {
        return social.follow(currentUser.current(), userId);
    }

    @DeleteMapping("/follows/{userId}")
    public ToggleResponse unfollow(@PathVariable("userId") UUID userId) {
        return social.unfollow(currentUser.current(), userId);
    }

    // ─── votes ──────────────────────────────────────────────────────────

    @PostMapping("/votes/{reportId}")
    public ToggleResponse upvote(@PathVariable("reportId") UUID reportId) {
        return social.upvote(currentUser.current(), reportId);
    }

    @DeleteMapping("/votes/{reportId}")
    public ToggleResponse unvote(@PathVariable("reportId") UUID reportId) {
        return social.unvote(currentUser.current(), reportId);
    }

    // ─── personal feed ──────────────────────────────────────────────────

    /**
     * "For you" home feed: reports from people the caller follows.
     * Split by kind so the openapk-frontend dashboard never surfaces BIN
     * reports and vice versa. Empty result is the legitimate "you follow
     * nobody yet" state — the frontend renders a CTA, not an error.
     */
    @GetMapping("/feed/{kind}")
    public List<CommunityReportSummary> feed(
            @PathVariable("kind") String kindStr,
            @RequestParam(value = "page", defaultValue = "0") int page,
            @RequestParam(value = "size", defaultValue = "20") int size
    ) {
        ProjectKind kind = ProjectKind.valueOf(kindStr.toUpperCase(java.util.Locale.ROOT));
        return social.personalFeed(currentUser.current(), kind, page, size);
    }
}
