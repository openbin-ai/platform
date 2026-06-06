package ai.openapk.core.projects;

import ai.openapk.core.auth.User;
import jakarta.persistence.Column;
import jakarta.persistence.EmbeddedId;
import jakarta.persistence.Entity;
import jakarta.persistence.EnumType;
import jakarta.persistence.Enumerated;
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
 * Sidecar row granting a non-owner user access to a project at a specific
 * role tier. Composite PK on (project_id, user_id) enforces one role per
 * user per project. See {@link ProjectRole} for tier semantics.
 *
 * <p>The owner is NOT represented here — ownership lives on
 * {@link Project#getUser()}. {@link ProjectAccessGuard} unifies the two
 * sources for caller-side access checks.
 */
@Entity
@Table(name = "project_collaborators")
@Getter
@Setter
@NoArgsConstructor
public class ProjectCollaborator {

    @EmbeddedId
    private Id id;

    @ManyToOne(optional = false)
    @MapsId("projectId")
    @JoinColumn(name = "project_id")
    private Project project;

    @ManyToOne(optional = false)
    @MapsId("userId")
    @JoinColumn(name = "user_id")
    private User user;

    @Enumerated(EnumType.STRING)
    @Column(nullable = false, length = 16)
    private ProjectRole role;

    /**
     * Who added this collaborator. Today this is always the project owner
     * (only owners can grant access), but we store it so a future "any
     * editor can invite another viewer" relaxation has the audit data.
     */
    @ManyToOne(optional = false)
    @JoinColumn(name = "invited_by", nullable = false)
    private User invitedBy;

    @Column(name = "created_at", nullable = false)
    private Instant createdAt;

    @PrePersist
    void prePersist() {
        if (createdAt == null) createdAt = Instant.now();
    }

    /**
     * Composite key required by {@code @EmbeddedId}. Mirrors the
     * {@code (project_id, user_id)} PRIMARY KEY in V26. Equality is
     * field-wise so the persistence context can identify rows reliably.
     */
    @lombok.Getter
    @lombok.Setter
    @lombok.NoArgsConstructor
    @lombok.AllArgsConstructor
    @jakarta.persistence.Embeddable
    public static class Id implements Serializable {
        private UUID projectId;
        private UUID userId;

        @Override
        public boolean equals(Object o) {
            if (this == o) return true;
            if (!(o instanceof Id other)) return false;
            return Objects.equals(projectId, other.projectId)
                    && Objects.equals(userId, other.userId);
        }

        @Override
        public int hashCode() {
            return Objects.hash(projectId, userId);
        }
    }
}
