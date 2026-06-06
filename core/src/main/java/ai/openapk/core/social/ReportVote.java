package ai.openapk.core.social;

import ai.openapk.core.auth.User;
import ai.openapk.core.reports.ProjectReport;
import jakarta.persistence.Column;
import jakarta.persistence.EmbeddedId;
import jakarta.persistence.Entity;
import jakarta.persistence.JoinColumn;
import jakarta.persistence.ManyToOne;
import jakarta.persistence.MapsId;
import jakarta.persistence.PrePersist;
import jakarta.persistence.Table;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;

import java.io.Serializable;
import java.time.Instant;
import java.util.Objects;
import java.util.UUID;

/**
 * Per-user upvote on a community-published report. One row per
 * (user, report) — the composite PK guarantees idempotence for repeat
 * POSTs from a flaky client. There is no "score" column; an upvote is a
 * boolean signal aggregated by row count at read time.
 */
@Entity
@Table(name = "report_votes")
@Getter
@Setter
@NoArgsConstructor
public class ReportVote {

    @EmbeddedId
    private Id id;

    @ManyToOne(optional = false)
    @MapsId("userId")
    @JoinColumn(name = "user_id")
    private User user;

    @ManyToOne(optional = false)
    @MapsId("reportId")
    @JoinColumn(name = "report_id")
    private ProjectReport report;

    @Column(name = "created_at", nullable = false)
    private Instant createdAt;

    @PrePersist
    void prePersist() {
        if (createdAt == null) createdAt = Instant.now();
    }

    @lombok.Getter
    @lombok.Setter
    @lombok.NoArgsConstructor
    @lombok.AllArgsConstructor
    @jakarta.persistence.Embeddable
    public static class Id implements Serializable {
        private UUID userId;
        private UUID reportId;

        @Override
        public boolean equals(Object o) {
            if (this == o) return true;
            if (!(o instanceof Id other)) return false;
            return Objects.equals(userId, other.userId)
                    && Objects.equals(reportId, other.reportId);
        }

        @Override
        public int hashCode() {
            return Objects.hash(userId, reportId);
        }
    }
}
