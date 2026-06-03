package ai.openapk.core.reports;

import org.springframework.data.jpa.repository.JpaRepository;

import java.util.Optional;
import java.util.UUID;

public interface ProjectReportRepository extends JpaRepository<ProjectReport, UUID> {

    Optional<ProjectReport> findByProjectId(UUID projectId);
}
