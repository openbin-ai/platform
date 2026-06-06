package ai.openapk.core.reports;

import ai.openapk.core.auth.CurrentUserService;
import ai.openapk.core.media.MediaService;
import ai.openapk.core.projects.ProjectKind;
import ai.openapk.core.reports.dto.AbuseReportRequest;
import ai.openapk.core.reports.dto.CommunityReportDetail;
import ai.openapk.core.reports.dto.CommunityReportSummary;
import ai.openapk.core.social.SocialService;
import ai.openapk.core.social.dto.ProfileResponse;
import jakarta.validation.Valid;
import org.springframework.core.io.FileSystemResource;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;

import java.net.URI;
import java.util.List;
import java.util.UUID;

/**
 * Anonymous read endpoints for the /community feed. Mounted under
 * /api/community/** which is permitted in {@link ai.openapk.core.config.SecurityConfig}
 * without auth. Feed listings are split per project kind so openapk.ai
 * shows only APK reports and openbin.ai shows only BIN — the split-per-
 * product decision made during slim community v1 scoping.
 *
 * <p>Single-report read + abuse-report POST are kind-agnostic and live
 * at /api/community/reports/{id} so the same shareable URL works
 * regardless of which frontend the user lands on.
 */
@RestController
@RequestMapping("/api/community")
public class CommunityController {

    private final CommunityService service;
    private final SocialService social;
    private final CurrentUserService currentUser;

    public CommunityController(CommunityService service, SocialService social,
                               CurrentUserService currentUser) {
        this.service = service;
        this.social = social;
        this.currentUser = currentUser;
    }

    /**
     * APK reports feed. Returns the latest published APK community
     * reports for openapk.ai. Filters are all optional; combine them
     * freely. {@code sha256} short-circuits everything else when present
     * (a binary hash is an exact identity). {@code sort=trending} ranks
     * by upvotes desc (recency as tiebreaker); default is chronological.
     */
    @GetMapping("/apk/reports")
    public List<CommunityReportSummary> apkFeed(
            @RequestParam(value = "q", required = false) String q,
            @RequestParam(value = "malware_type", required = false) String malwareType,
            @RequestParam(value = "tag", required = false) List<String> tags,
            @RequestParam(value = "sha256", required = false) String sha256,
            @RequestParam(value = "sort", required = false) String sort,
            @RequestParam(value = "page", defaultValue = "0") int page,
            @RequestParam(value = "size", defaultValue = "20") int size
    ) {
        return service.feed(ProjectKind.APK, q, malwareType, tags, sha256, sort, page, size);
    }

    /** BIN reports feed — same as apkFeed but for openbin.ai. */
    @GetMapping("/bin/reports")
    public List<CommunityReportSummary> binFeed(
            @RequestParam(value = "q", required = false) String q,
            @RequestParam(value = "malware_type", required = false) String malwareType,
            @RequestParam(value = "tag", required = false) List<String> tags,
            @RequestParam(value = "sha256", required = false) String sha256,
            @RequestParam(value = "sort", required = false) String sort,
            @RequestParam(value = "page", defaultValue = "0") int page,
            @RequestParam(value = "size", defaultValue = "20") int size
    ) {
        return service.feed(ProjectKind.BIN, q, malwareType, tags, sha256, sort, page, size);
    }

    /**
     * Public author profile + that user's community-published reports for
     * the requested product kind. Anonymous-readable; the response's
     * {@code amFollowing} field is always false for unauthenticated
     * callers. Kept under {@code /api/community} (anonymous-permitted)
     * rather than {@code /api/social} so signed-out visitors can land on
     * a researcher's page from a shared link.
     */
    @GetMapping("/users/{userId}/profile/{kind}")
    public ProfileResponse profile(
            @PathVariable("userId") UUID userId,
            @PathVariable("kind") String kindStr
    ) {
        ProjectKind kind = ProjectKind.valueOf(kindStr.toUpperCase(java.util.Locale.ROOT));
        return social.profile(userId, currentUser.currentOrNull(), kind);
    }

    /**
     * Single published report, kind-agnostic. 404 for unpublished or
     * missing reports — intentionally identical responses so anonymous
     * probing can't distinguish "private" from "doesn't exist".
     */
    @GetMapping("/reports/{id}")
    public CommunityReportDetail read(@PathVariable("id") UUID id) {
        return service.read(id);
    }

    /**
     * Anonymous abuse-report flagging. Emails the configured admin via
     * SES (or logs and returns in dev). Always 204 — we don't leak
     * whether the email actually went out, both as a courtesy to ops
     * and to avoid handing a malicious flagger a reliable probe.
     */
    @PostMapping("/reports/{id}/abuse")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    public void abuse(@PathVariable("id") UUID id, @Valid @RequestBody AbuseReportRequest req) {
        service.reportAbuse(id, req);
    }

    /**
     * Anonymous-readable screenshot for a community-published report. The
     * shape mirrors {@link ai.openapk.core.media.MediaController#get} but
     * for the public path: no Bearer required, scoped to filenames the
     * report actually references. For S3 we 302 straight to a presigned URL
     * (works fine for {@code <img src>} since no Authorization header is
     * carried). For the fs backend we stream bytes directly.
     */
    @GetMapping("/reports/{reportId}/media/{filename}")
    public ResponseEntity<?> media(
            @PathVariable("reportId") UUID reportId,
            @PathVariable("filename") String filename
    ) {
        MediaService.Resolved resolved = service.resolveMedia(reportId, filename);
        if (resolved instanceof MediaService.Resolved.Presigned p) {
            URI url = p.url();
            return ResponseEntity.status(HttpStatus.FOUND)
                    .header(HttpHeaders.LOCATION, url.toString())
                    .header(HttpHeaders.CACHE_CONTROL, "public, max-age=300")
                    .build();
        }
        var path = ((MediaService.Resolved.Local) resolved).path();
        return ResponseEntity.ok()
                .contentType(MediaType.IMAGE_PNG)
                .header(HttpHeaders.CACHE_CONTROL, "public, max-age=3600")
                .body(new FileSystemResource(path));
    }
}
