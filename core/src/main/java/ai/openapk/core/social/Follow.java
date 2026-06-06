package ai.openapk.core.social;

import ai.openapk.core.auth.User;
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
 * Directional follow relationship: {@code follower} subscribes to
 * {@code followee}'s published reports. Mirrors V27's {@code follows}
 * table; the CHECK constraint there enforces follower &ne; followee at
 * the DB layer so we don't have to in code.
 */
@Entity
@Table(name = "follows")
@Getter
@Setter
@NoArgsConstructor
public class Follow {

    @EmbeddedId
    private Id id;

    @ManyToOne(optional = false)
    @MapsId("followerId")
    @JoinColumn(name = "follower_id")
    private User follower;

    @ManyToOne(optional = false)
    @MapsId("followeeId")
    @JoinColumn(name = "followee_id")
    private User followee;

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
        private UUID followerId;
        private UUID followeeId;

        @Override
        public boolean equals(Object o) {
            if (this == o) return true;
            if (!(o instanceof Id other)) return false;
            return Objects.equals(followerId, other.followerId)
                    && Objects.equals(followeeId, other.followeeId);
        }

        @Override
        public int hashCode() {
            return Objects.hash(followerId, followeeId);
        }
    }
}
