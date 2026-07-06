package ai.openapk.core.projects;

import jakarta.persistence.Column;
import jakarta.persistence.EmbeddedId;
import jakarta.persistence.Entity;
import jakarta.persistence.Table;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;

import java.io.Serializable;
import java.time.Instant;
import java.util.Objects;
import java.util.UUID;

/**
 * When a user was last active inside a project. Populated by a heartbeat the
 * client pings while a project is open (see
 * {@link ProjectCollaboratorService#heartbeat}) and read by the /members
 * roster. Covers the owner as well as collaborators — the owner has no
 * {@link ProjectCollaborator} row, so presence lives in its own table keyed
 * by (project_id, user_id).
 */
@Entity
@Table(name = "project_presence")
@Getter
@Setter
@NoArgsConstructor
public class ProjectPresence {

    @EmbeddedId
    private Id id;

    @Column(name = "last_active_at", nullable = false)
    private Instant lastActiveAt;

    @Getter
    @Setter
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
