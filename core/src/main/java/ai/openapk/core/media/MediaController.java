package ai.openapk.core.media;

import ai.openapk.core.auth.CurrentUserService;
import ai.openapk.core.media.dto.MediaItem;
import org.springframework.core.io.FileSystemResource;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.multipart.MultipartFile;

import java.util.List;
import java.util.UUID;

@RestController
@RequestMapping("/api/projects/{id}/media")
public class MediaController {

    private final MediaService service;
    private final CurrentUserService currentUser;

    public MediaController(MediaService service, CurrentUserService currentUser) {
        this.service = service;
        this.currentUser = currentUser;
    }

    @PostMapping
    public MediaService.Stored upload(@PathVariable("id") UUID id, @RequestParam("file") MultipartFile file) {
        return service.save(currentUser.current(), id, file);
    }

    @GetMapping
    public List<MediaItem> list(@PathVariable("id") UUID id) {
        return service.list(currentUser.current(), id);
    }

    /**
     * Returns the bytes (fs backend) OR a JSON {@code {"url": ...}} pointing at
     * a short-lived S3 presigned URL (s3 backend).
     *
     * <p>The JSON shape exists because Firefox refuses to follow a 302 to S3
     * across origins when the original fetch carried an Authorization header
     * (mixed CORS-with-credentials redirect chain). Returning the URL lets the
     * frontend plug it straight into an {@code <img src>} -- no fetch, no
     * preflight, no redirect.
     */
    @GetMapping("/{name}")
    public ResponseEntity<?> get(@PathVariable("id") UUID id, @PathVariable("name") String name) {
        MediaService.Resolved resolved = service.resolveForServe(currentUser.current(), id, name);
        if (resolved instanceof MediaService.Resolved.Presigned p) {
            return ResponseEntity.ok()
                    .contentType(MediaType.APPLICATION_JSON)
                    .header(HttpHeaders.CACHE_CONTROL, "private, max-age=300")
                    .body(java.util.Map.of("url", p.url().toString()));
        }
        // Filesystem backend: stream from local disk.
        var path = ((MediaService.Resolved.Local) resolved).path();
        return ResponseEntity.ok()
                .contentType(MediaType.IMAGE_PNG)
                .header(HttpHeaders.CACHE_CONTROL, "private, max-age=3600")
                .body(new FileSystemResource(path));
    }

    @DeleteMapping("/{name}")
    public ResponseEntity<Void> delete(@PathVariable("id") UUID id, @PathVariable("name") String name) {
        service.delete(currentUser.current(), id, name);
        return ResponseEntity.noContent().build();
    }
}
