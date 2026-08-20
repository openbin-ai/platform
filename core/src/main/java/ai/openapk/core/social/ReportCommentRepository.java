package ai.openapk.core.social;

import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;
import java.util.UUID;

public interface ReportCommentRepository extends JpaRepository<ReportComment, UUID> {

    /**
     * All comments on a report in arrival order. The service layer builds
     * the parent → children tree from this flat list — a recursive CTE
     * would be one query but JPA's recursive support is awful and the
     * flat-list approach is fine at expected per-report comment counts.
     */
    List<ReportComment> findAllByReportIdOrderByCreatedAtAsc(UUID reportId);

    /**
     * Per-report comment count for feed-card badges ("12 comments"). Counts
     * soft-deleted rows because the thread still exists from the reader's
     * point of view, just with one entry redacted.
     */
    long countByReportId(UUID reportId);

    /** Blog-post thread, same ordering as the report thread. */
    List<ReportComment> findAllByPostIdOrderByCreatedAtAsc(UUID postId);

    long countByPostId(UUID postId);
}
