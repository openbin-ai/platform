package ai.openapk.core.usage;

import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;

import java.time.Instant;
import java.util.UUID;

public interface LlmAuditRepository extends JpaRepository<LlmAuditEntry, UUID> {

    Page<LlmAuditEntry> findAllByUserIdOrderByCreatedAtDesc(UUID userId, Pageable pageable);

    /**
     * Sum of input + output tokens for this user since `since`. Used for budget
     * windows (daily, monthly). COALESCE keeps the return type non-null when
     * there are zero rows in the window.
     */
    @Query("""
            SELECT COALESCE(SUM(e.inputTokens + e.outputTokens), 0)
            FROM LlmAuditEntry e
            WHERE e.user.id = :userId AND e.createdAt >= :since
            """)
    long sumTokensSince(UUID userId, Instant since);
}
