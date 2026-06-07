package ai.openapk.core.notifications;

import ai.openapk.core.auth.User;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.FetchType;
import jakarta.persistence.Id;
import jakarta.persistence.JoinColumn;
import jakarta.persistence.MapsId;
import jakarta.persistence.OneToOne;
import jakarta.persistence.PrePersist;
import jakarta.persistence.PreUpdate;
import jakarta.persistence.Table;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;

import java.time.Instant;
import java.util.UUID;

/**
 * Per-user opt-out flags for transactional email. Row is created lazily the
 * first time a user PATCHes their settings; before that, defaults (all ON)
 * apply. Mirrors {@link ai.openapk.core.usage.LlmUserLimits} which uses the
 * same lazy-row pattern.
 */
@Entity
@Table(name = "user_email_preferences")
@Getter
@Setter
@NoArgsConstructor
public class UserEmailPrefs {

    @Id
    @Column(name = "user_id")
    private UUID userId;

    @OneToOne(fetch = FetchType.LAZY, optional = false)
    @MapsId
    @JoinColumn(name = "user_id")
    private User user;

    @Column(name = "notify_decompile_complete", nullable = false)
    private boolean notifyDecompileComplete = true;

    @Column(name = "notify_report_published", nullable = false)
    private boolean notifyReportPublished = true;

    @Column(name = "notify_abuse_confirmation", nullable = false)
    private boolean notifyAbuseConfirmation = true;

    @Column(name = "notify_new_follower", nullable = false)
    private boolean notifyNewFollower = true;

    @Column(name = "notify_comment_on_my_report", nullable = false)
    private boolean notifyCommentOnMyReport = true;

    @Column(name = "notify_reply_to_my_comment", nullable = false)
    private boolean notifyReplyToMyComment = true;

    @Column(name = "notify_collaborator_invite", nullable = false)
    private boolean notifyCollaboratorInvite = true;

    @Column(name = "created_at", nullable = false)
    private Instant createdAt;

    @Column(name = "updated_at", nullable = false)
    private Instant updatedAt;

    @PrePersist
    void prePersist() {
        var now = Instant.now();
        if (createdAt == null) createdAt = now;
        updatedAt = now;
    }

    @PreUpdate
    void preUpdate() {
        updatedAt = Instant.now();
    }
}
