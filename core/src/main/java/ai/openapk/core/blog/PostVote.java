package ai.openapk.core.blog;

import ai.openapk.core.auth.User;
import jakarta.persistence.Column;
import jakarta.persistence.Embeddable;
import jakarta.persistence.EmbeddedId;
import jakarta.persistence.Entity;
import jakarta.persistence.JoinColumn;
import jakarta.persistence.ManyToOne;
import jakarta.persistence.MapsId;
import jakarta.persistence.PrePersist;
import jakarta.persistence.Table;
import lombok.AllArgsConstructor;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;

import java.io.Serializable;
import java.time.Instant;
import java.util.Objects;
import java.util.UUID;

/**
 * One upvote by one user on one post. Same shape as {@code ReportVote}:
 * presence IS the vote, there's no score column, and the count is a row
 * count at read time. The composite key makes a double-POST from a flaky
 * client idempotent.
 */
@Entity
@Table(name = "post_votes")
@Getter
@Setter
@NoArgsConstructor
public class PostVote {

    @EmbeddedId
    private Id id;

    @ManyToOne(optional = false)
    @MapsId("userId")
    @JoinColumn(name = "user_id")
    private User user;

    @ManyToOne(optional = false)
    @MapsId("postId")
    @JoinColumn(name = "post_id")
    private BlogPost post;

    @Column(name = "created_at", nullable = false)
    private Instant createdAt;

    @PrePersist
    void prePersist() {
        if (createdAt == null) createdAt = Instant.now();
    }

    @Getter
    @Setter
    @NoArgsConstructor
    @AllArgsConstructor
    @Embeddable
    public static class Id implements Serializable {
        private UUID userId;
        private UUID postId;

        @Override
        public boolean equals(Object o) {
            if (this == o) return true;
            if (!(o instanceof Id other)) return false;
            return Objects.equals(userId, other.userId) && Objects.equals(postId, other.postId);
        }

        @Override
        public int hashCode() {
            return Objects.hash(userId, postId);
        }
    }
}
