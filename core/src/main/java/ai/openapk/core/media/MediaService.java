package ai.openapk.core.media;

import ai.openapk.core.auth.User;
import ai.openapk.core.config.OpenApkProperties;
import ai.openapk.core.media.dto.MediaItem;
import ai.openapk.core.projects.Project;
import ai.openapk.core.projects.ProjectRepository;
import ai.openapk.core.projects.storage.ProjectStorage;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.web.multipart.MultipartFile;
import org.springframework.web.server.ResponseStatusException;

import java.io.IOException;
import java.net.URI;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Duration;
import java.util.List;
import java.util.UUID;

@Service
public class MediaService {

    private static final Logger log = LoggerFactory.getLogger(MediaService.class);

    private static final long MAX_BYTES = 10L * 1024 * 1024; // 10MB
    private static final String CONTENT_TYPE = "image/png";

    private final ProjectStorage storage;
    private final ProjectRepository projectRepo;
    private final Duration presignedTtl;

    public MediaService(ProjectStorage storage, ProjectRepository projectRepo, OpenApkProperties props) {
        this.storage = storage;
        this.projectRepo = projectRepo;
        Duration ttl = props.storage() != null ? props.storage().presignedUrlTtl() : null;
        this.presignedTtl = ttl != null ? ttl : Duration.ofMinutes(15);
    }

    public record Stored(String filename, String url) {}

    /**
     * Result of resolving a media filename for serving. {@link Presigned}
     * lets the controller issue a 302 redirect (S3 path); {@link Local} lets
     * it stream {@code FileSystemResource} (fs path).
     */
    public sealed interface Resolved {
        record Presigned(URI url) implements Resolved {}
        record Local(Path path) implements Resolved {}
    }

    public Stored save(User user, UUID projectId, MultipartFile file) {
        Project project = loadProject(user, projectId);
        if (file == null || file.isEmpty()) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "empty file");
        }
        if (file.getSize() > MAX_BYTES) {
            throw new ResponseStatusException(HttpStatus.CONTENT_TOO_LARGE, "max 10MB");
        }
        if (!CONTENT_TYPE.equals(file.getContentType())) {
            throw new ResponseStatusException(HttpStatus.UNSUPPORTED_MEDIA_TYPE, "only image/png");
        }

        Path dir = storage.mediaDir(user.getId(), project.getId());
        try {
            Files.createDirectories(dir);
        } catch (IOException e) {
            throw new ResponseStatusException(HttpStatus.INTERNAL_SERVER_ERROR, "cannot create media dir: " + e.getMessage());
        }

        String filename = UUID.randomUUID() + ".png";
        Path target = dir.resolve(filename);
        try {
            file.transferTo(target);
        } catch (IOException e) {
            throw new ResponseStatusException(HttpStatus.INTERNAL_SERVER_ERROR, "media write failed: " + e.getMessage());
        }

        // Push to durable storage. On the fs backend this is a no-op; on S3
        // it uploads to the bucket. Synchronous so the upload POST doesn't
        // return success until the bytes are safe.
        try {
            storage.afterMediaWrite(user.getId(), project.getId(), filename);
        } catch (IOException e) {
            // Roll back the local write so the user can retry cleanly.
            try { Files.deleteIfExists(target); } catch (IOException ignored) {}
            throw new ResponseStatusException(HttpStatus.INTERNAL_SERVER_ERROR, "media persist failed: " + e.getMessage());
        }

        String url = "/api/projects/" + projectId + "/media/" + filename;
        log.info("Stored media {} for project {}", filename, projectId);
        return new Stored(filename, url);
    }

    public List<MediaItem> list(User user, UUID projectId) {
        Project project = loadProject(user, projectId);
        try {
            return storage.listMedia(user.getId(), project.getId()).stream()
                    .map(e -> new MediaItem(
                            e.filename(),
                            "/api/projects/" + projectId + "/media/" + e.filename(),
                            e.sizeBytes(),
                            e.createdAt()))
                    .toList();
        } catch (IOException e) {
            throw new ResponseStatusException(HttpStatus.INTERNAL_SERVER_ERROR, "media list failed: " + e.getMessage());
        }
    }

    public void delete(User user, UUID projectId, String filename) {
        Project project = loadProject(user, projectId);
        validateFilename(filename);
        try {
            storage.deleteMedia(user.getId(), project.getId(), filename);
            log.info("Deleted media {} for project {}", filename, projectId);
        } catch (IOException e) {
            throw new ResponseStatusException(HttpStatus.INTERNAL_SERVER_ERROR, "media delete failed: " + e.getMessage());
        }
    }

    /**
     * Resolve a media filename for serving. Tries to return a presigned URL
     * (S3 backend) so the controller can 302 the browser straight to S3 and
     * skip streaming bytes through the app. Falls back to a local
     * {@link Path} for the fs backend.
     */
    public Resolved resolveForServe(User user, UUID projectId, String filename) {
        Project project = loadProject(user, projectId);
        validateFilename(filename);
        URI presigned = storage.presignMedia(user.getId(), project.getId(), filename, presignedTtl);
        if (presigned != null) {
            return new Resolved.Presigned(presigned);
        }
        Path file = storage.mediaDir(user.getId(), project.getId()).resolve(filename);
        if (!Files.exists(file)) {
            throw new ResponseStatusException(HttpStatus.NOT_FOUND, "media not found");
        }
        return new Resolved.Local(file);
    }

    /**
     * Anonymous-readable variant for community-published reports. Skips
     * the per-user project lookup — the caller (CommunityService) is
     * responsible for verifying the report is publicly published AND that
     * the filename is actually referenced by that report. Resolves storage
     * by the project's owning user.
     */
    public Resolved resolvePublic(UUID projectId, String filename) {
        Project project = projectRepo.findById(projectId)
                .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND, "media not found"));
        validateFilename(filename);
        UUID ownerId = project.getUser().getId();
        URI presigned = storage.presignMedia(ownerId, project.getId(), filename, presignedTtl);
        if (presigned != null) {
            return new Resolved.Presigned(presigned);
        }
        Path file = storage.mediaDir(ownerId, project.getId()).resolve(filename);
        if (!Files.exists(file)) {
            throw new ResponseStatusException(HttpStatus.NOT_FOUND, "media not found");
        }
        return new Resolved.Local(file);
    }

    private void validateFilename(String filename) {
        // Filename safety: must be a UUID + ".png", no path separators.
        if (!filename.matches("^[0-9a-f-]{36}\\.png$")) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "invalid filename");
        }
    }

    private Project loadProject(User user, UUID projectId) {
        return projectRepo.findByIdAndUserId(projectId, user.getId())
                .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND, "project not found"));
    }
}
