package ai.openapk.core.social;

import ai.openapk.core.auth.User;
import ai.openapk.core.reports.ProjectReport;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.FetchType;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import jakarta.persistence.Id;
import jakarta.persistence.JoinColumn;
import jakarta.persistence.ManyToOne;
import jakarta.persistence.PrePersist;
import jakarta.persistence.Table;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;

import java.time.Instant;
import java.util.UUID;

/**
 * A user-authored comment on a community-published report. Supports one
 * level of nesting via {@link #parent} (top-level comments have it
 * {@code null}). Soft-deletes via {@link #deletedAt} so reply chains stay
 * intact when a parent comment is removed.
 */
@Entity
@Table(name = "report_comments")
@Getter
@Setter
@NoArgsConstructor
public class ReportComment {

    @Id
    @GeneratedValue(strategy = GenerationType.UUID)
    private UUID id;

    @ManyToOne(fetch = FetchType.LAZY, optional = false)
    @JoinColumn(name = "report_id", nullable = false)
    private ProjectReport report;

    @ManyToOne(fetch = FetchType.LAZY, optional = false)
    @JoinColumn(name = "user_id", nullable = false)
    private User user;

    /**
     * Top-level comments have {@code parent == null}. Replies point at the
     * top-level comment they reply to — we don't allow reply-of-reply,
     * keeping the thread depth at exactly two levels.
     */
    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "parent_comment_id")
    private ReportComment parent;

    @Column(nullable = false)
    private String body;

    @Column(name = "created_at", nullable = false)
    private Instant createdAt;

    /** Non-null = soft-deleted; body is masked at read time. */
    @Column(name = "deleted_at")
    private Instant deletedAt;

    @PrePersist
    void prePersist() {
        if (createdAt == null) createdAt = Instant.now();
    }
}
