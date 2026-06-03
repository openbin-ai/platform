package ai.openapk.core.renames;

import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;
import java.util.Optional;
import java.util.UUID;

public interface ProjectRenameRepository extends JpaRepository<ProjectRename, UUID> {
    List<ProjectRename> findByProjectIdOrderByCreatedAtDesc(UUID projectId);
    List<ProjectRename> findByProjectIdAndStatus(UUID projectId, RenameStatus status);
    Optional<ProjectRename> findByProjectIdAndOriginal(UUID projectId, String original);
}
