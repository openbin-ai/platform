package ai.openapk.core.projects.samples;

import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;
import java.util.Optional;
import java.util.UUID;

public interface ProjectSampleRepository extends JpaRepository<ProjectSample, UUID> {

    List<ProjectSample> findAllByProjectIdOrderByCreatedAtAsc(UUID projectId);

    Optional<ProjectSample> findByProjectIdAndSha256(UUID projectId, String sha256);

    long countByProjectId(UUID projectId);
}
