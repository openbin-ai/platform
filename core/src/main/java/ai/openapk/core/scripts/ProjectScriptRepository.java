package ai.openapk.core.scripts;

import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;
import java.util.Optional;
import java.util.UUID;

public interface ProjectScriptRepository extends JpaRepository<ProjectScript, UUID> {

    List<ProjectScript> findAllByProjectIdOrderByCreatedAtDesc(UUID projectId);

    Optional<ProjectScript> findByIdAndProjectId(UUID id, UUID projectId);

    long countByProjectId(UUID projectId);
}
