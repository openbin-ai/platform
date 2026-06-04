package ai.openapk.core.usage;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import jakarta.persistence.Id;
import jakarta.persistence.PrePersist;
import jakarta.persistence.Table;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;

import java.time.Instant;
import java.util.UUID;

/**
 * Audit row for one cloud worker dispatch (Ghidra or JADX). Used both for
 * post-hoc cost forensics and as the source-of-truth counter for the
 * per-user daily quota gate. {@code success} starts NULL when the row is
 * inserted at dispatch time, and is updated on completion. Count queries
 * for the quota gate ignore {@code success} — a started job consumes a
 * slot regardless of outcome (no refunds in Phase 0).
 */
@Entity
@Table(name = "worker_runs")
@Getter
@Setter
@NoArgsConstructor
public class WorkerRun {

    @Id
    @GeneratedValue(strategy = GenerationType.UUID)
    private UUID id;

    @Column(name = "user_id", nullable = false)
    private UUID userId;

    /** Nullable: not every worker invocation is tied to a project yet. */
    @Column(name = "project_id")
    private UUID projectId;

    /** {@code "ghidra"} or {@code "jadx"}. Free-form string, validated by callers. */
    @Column(name = "worker_type", nullable = false)
    private String workerType;

    /** Null = in flight, true = succeeded, false = failed. */
    @Column
    private Boolean success;

    @Column(name = "error_message")
    private String errorMessage;

    @Column(name = "created_at", nullable = false)
    private Instant createdAt;

    @PrePersist
    void prePersist() {
        if (createdAt == null) createdAt = Instant.now();
    }
}
