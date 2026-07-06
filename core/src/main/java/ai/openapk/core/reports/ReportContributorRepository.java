package ai.openapk.core.reports;

import org.springframework.data.jpa.repository.JpaRepository;

import java.util.Collection;
import java.util.List;
import java.util.UUID;

public interface ReportContributorRepository extends JpaRepository<ReportContributor, UUID> {

    List<ReportContributor> findByReportIdOrderByPositionAsc(UUID reportId);

    List<ReportContributor> findByReportIdInOrderByReportIdAscPositionAsc(Collection<UUID> reportIds);

    void deleteByReportId(UUID reportId);
}
