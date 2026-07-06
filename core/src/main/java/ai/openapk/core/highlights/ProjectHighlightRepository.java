package ai.openapk.core.highlights;

import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import java.util.List;
import java.util.Optional;
import java.util.UUID;

public interface ProjectHighlightRepository extends JpaRepository<ProjectHighlight, UUID> {

    @Query("select h from ProjectHighlight h where h.project.id = :projectId "
            + "order by h.position asc, h.createdAt asc")
    List<ProjectHighlight> findAllByProjectIdOrdered(@Param("projectId") UUID projectId);

    Optional<ProjectHighlight> findByIdAndProjectId(UUID id, UUID projectId);

    @Query("select coalesce(max(h.position), -1) from ProjectHighlight h where h.project.id = :projectId")
    int maxPosition(@Param("projectId") UUID projectId);
}
