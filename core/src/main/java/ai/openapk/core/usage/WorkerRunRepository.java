package ai.openapk.core.usage;

import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;

import java.time.Instant;
import java.util.UUID;

public interface WorkerRunRepository extends JpaRepository<WorkerRun, UUID> {

    /**
     * Count of worker runs this user started since {@code since}. Backs the
     * daily-cap quota gate — call with the start of the current UTC day.
     * Includes in-flight and failed runs by design (a started job consumes
     * a slot regardless of outcome in Phase 0; refunds come with the real
     * credits system).
     */
    @Query("""
            SELECT COUNT(r)
            FROM WorkerRun r
            WHERE r.userId = :userId AND r.createdAt >= :since
            """)
    long countSince(UUID userId, Instant since);
}
