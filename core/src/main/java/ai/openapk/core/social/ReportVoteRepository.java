package ai.openapk.core.social;

import org.springframework.data.jpa.repository.JpaRepository;

import java.util.UUID;

public interface ReportVoteRepository extends JpaRepository<ReportVote, ReportVote.Id> {

    /**
     * Per-report aggregate used by the feed cards. The community feed
     * query itself does this as a single GROUP BY join (avoids N+1), but
     * this method exists for the single-report detail endpoint where one
     * extra query is fine and a JPQL aggregate is easier to read.
     */
    long countByReportId(UUID reportId);

    /**
     * Existence check for "did the current viewer upvote this report?" —
     * read on each feed/detail render. Drives the upvote button's filled
     * vs. outline state and prevents double-vote retries.
     */
    boolean existsByUserIdAndReportId(UUID userId, UUID reportId);
}
