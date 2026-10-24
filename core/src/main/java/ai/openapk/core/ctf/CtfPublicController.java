package ai.openapk.core.ctf;

import ai.openapk.core.auth.CurrentUserService;
import ai.openapk.core.ctf.dto.CtfDtos.BinaryDownload;
import ai.openapk.core.ctf.dto.CtfDtos.ChallengeDetail;
import ai.openapk.core.ctf.dto.CtfDtos.ChallengeSummary;
import ai.openapk.core.ctf.dto.CtfDtos.CtfHome;
import ai.openapk.core.ctf.dto.CtfDtos.Leaderboard;
import org.springframework.core.io.FileSystemResource;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
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

    /**
     * The raw binary. On S3 this is a 302 to a short-lived presigned URL
     * with an attachment disposition; on the fs backend the file streams
     * from here. 404 before the window opens or when nothing is attached.
     */
    @GetMapping("/challenges/{slug}/download")
    public ResponseEntity<?> download(@PathVariable String slug) {
        BinaryDownload d = service.binaryDownload(slug);
        if (d.redirect() != null) {
            return ResponseEntity.status(HttpStatus.FOUND)
                    .header(HttpHeaders.LOCATION, d.redirect().toString())
                    .header(HttpHeaders.CACHE_CONTROL, "no-store")
                    .build();
        }
        return ResponseEntity.ok()
                .contentType(MediaType.APPLICATION_OCTET_STREAM)
                .header(HttpHeaders.CONTENT_DISPOSITION, "attachment; filename=\"" + d.filename() + "\"")
                .contentLength(d.size() > 0 ? d.size() : d.file().toFile().length())
                .body(new FileSystemResource(d.file()));
    }

    @GetMapping("/leaderboard")
    public Leaderboard leaderboard(@RequestParam(defaultValue = "season") String scope,
                                   @RequestParam(required = false) String season) {
        return service.leaderboard(scope, season);
    }
}
