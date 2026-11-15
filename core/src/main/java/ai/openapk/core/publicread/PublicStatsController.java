package ai.openapk.core.publicread;

import org.springframework.http.CacheControl;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RestController;

import java.util.LinkedHashMap;
import java.util.Map;

/**
 * {@code GET /api/public/stats} — anonymous, under the /api/public/**
 * permitAll. The static landings on openbin.ai and openapk.ai fetch it
 * cross-origin, so {@code SecurityConfig} gives this one path a wildcard
 * CORS entry (no credentials, GET only) instead of adding every landing
 * hostname to the credentialed allow-list.
 */
@RestController
public class PublicStatsController {

    private final PublicStatsService stats;

    public PublicStatsController(PublicStatsService stats) {
        this.stats = stats;
    }

    @GetMapping("/api/public/stats")
    public ResponseEntity<Map<String, Object>> stats() {
        var s = stats.current();
        var out = new LinkedHashMap<String, Object>();
        out.put("users", s.users());
        out.put("online", s.online());
        out.put("publicReports", s.publicReports());
        out.put("computedAt", s.computedAt().toString());
        return ResponseEntity.ok()
                .cacheControl(CacheControl.maxAge(PublicStatsService.TTL).cachePublic())
                .body(out);
    }
}
