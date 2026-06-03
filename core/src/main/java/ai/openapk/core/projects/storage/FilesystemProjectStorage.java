package ai.openapk.core.projects.storage;

import ai.openapk.core.config.OpenApkProperties;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.stereotype.Component;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.Comparator;
import java.util.UUID;
import java.util.stream.Stream;

/**
 * Filesystem-backed {@link ProjectStorage}. The workspace dir is the source
 * of truth — survives a single host restart but not a container recycle.
 * Dev default; switch to {@code S3ProjectStorage} for prod by setting
 * {@code openapk.storage.backend=s3}.
 */
@Component
@ConditionalOnProperty(name = "openapk.storage.backend", havingValue = "fs", matchIfMissing = true)
public class FilesystemProjectStorage implements ProjectStorage {

    private static final Logger log = LoggerFactory.getLogger(FilesystemProjectStorage.class);

    private final Path root;

    public FilesystemProjectStorage(OpenApkProperties props) {
        this.root = Path.of(props.workspace().dir()).toAbsolutePath().normalize();
        try {
            Files.createDirectories(this.root);
        } catch (IOException e) {
            throw new IllegalStateException("Cannot create workspace dir " + this.root, e);
        }
        log.info("Workspace dir: {}", this.root);
    }

    @Override
    public Path projectDir(UUID userId, UUID projectId) {
        return root.resolve("users").resolve(userId.toString()).resolve("projects").resolve(projectId.toString());
    }

    @Override
    public Path apkPath(UUID userId, UUID projectId) {
        return projectDir(userId, projectId).resolve("apk").resolve("original.apk");
    }

    @Override
    public Path binaryPath(UUID userId, UUID projectId) {
        return projectDir(userId, projectId).resolve("bin").resolve("original.bin");
    }

    @Override
    public Path srcDir(UUID userId, UUID projectId) {
        return projectDir(userId, projectId).resolve("src");
    }

    @Override
    public Path mediaDir(UUID userId, UUID projectId) {
        return projectDir(userId, projectId).resolve("media");
    }

    @Override
    public void deleteProject(UUID userId, UUID projectId) {
        Path dir = projectDir(userId, projectId);
        if (!Files.exists(dir)) return;
        try (Stream<Path> walk = Files.walk(dir)) {
            walk.sorted(Comparator.reverseOrder()).forEach(p -> {
                try {
                    Files.deleteIfExists(p);
                } catch (IOException e) {
                    log.warn("Failed to delete {}: {}", p, e.toString());
                }
            });
        } catch (IOException e) {
            log.warn("Failed to walk {} for delete: {}", dir, e.toString());
        }
    }
}
