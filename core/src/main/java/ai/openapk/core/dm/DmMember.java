package ai.openapk.core.dm;

import ai.openapk.core.auth.User;
import jakarta.persistence.Column;
import jakarta.persistence.EmbeddedId;
import jakarta.persistence.Entity;
import jakarta.persistence.FetchType;
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

/** One user's membership in a conversation, carrying their read cursor. */
@Entity
@Table(name = "dm_members")
@Getter
@Setter
@NoArgsConstructor
public class DmMember {

    @EmbeddedId
    private Id id;

    @ManyToOne(fetch = FetchType.LAZY, optional = false)
    @MapsId("conversationId")
    @JoinColumn(name = "conversation_id")
    private DmConversation conversation;

    @ManyToOne(fetch = FetchType.LAZY, optional = false)
    @MapsId("userId")
    @JoinColumn(name = "user_id")
    private User user;

    @Column(name = "joined_at", nullable = false)
    private Instant joinedAt;

    @Column(name = "last_read_at")
    private Instant lastReadAt;

    @PrePersist
    void prePersist() {
        if (joinedAt == null) joinedAt = Instant.now();
    }

    public static DmMember of(DmConversation c, User u) {
        DmMember m = new DmMember();
        m.setId(new Id(c.getId(), u.getId()));
        m.setConversation(c);
        m.setUser(u);
        return m;
    }

    @Getter
    @Setter
    @NoArgsConstructor
    @lombok.AllArgsConstructor
    @jakarta.persistence.Embeddable
    public static class Id implements Serializable {
        private UUID conversationId;
        private UUID userId;

        @Override
        public boolean equals(Object o) {
            if (this == o) return true;
            if (!(o instanceof Id other)) return false;
            return Objects.equals(conversationId, other.conversationId) && Objects.equals(userId, other.userId);
        }

        @Override
        public int hashCode() {
            return Objects.hash(conversationId, userId);
        }
    }
}
