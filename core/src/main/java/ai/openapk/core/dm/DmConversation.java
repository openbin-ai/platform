package ai.openapk.core.dm;

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
 * A private conversation. For 1:1 DMs {@link #pairKey} is the canonical
 * "{lesser uuid}:{greater uuid}" of the two members (UNIQUE), so get-or-create
 * is race-safe via the constraint. Group conversations (future CTF teams)
 * leave it null. See V42.
 */
@Entity
@Table(name = "dm_conversations")
@Getter
@Setter
@NoArgsConstructor
public class DmConversation {

    @Id
    @GeneratedValue(strategy = GenerationType.UUID)
    private UUID id;

    @Column(name = "pair_key")
    private String pairKey;

    /** Set for a project's team chat (V45); null for a 1:1 DM. */
    @Column(name = "project_id")
    private UUID projectId;

    public boolean isProjectChat() {
        return projectId != null;
    }

    @Column(name = "created_at", nullable = false)
    private Instant createdAt;

    @Column(name = "last_message_at")
    private Instant lastMessageAt;

    @Column(name = "last_message_preview")
    private String lastMessagePreview;

    @Column(name = "last_sender_id")
    private UUID lastSenderId;

    @PrePersist
    void prePersist() {
        if (createdAt == null) createdAt = Instant.now();
    }

    /** Canonical pair key for two user ids, independent of argument order. */
    public static String pairKeyFor(UUID a, UUID b) {
        return a.compareTo(b) < 0 ? a + ":" + b : b + ":" + a;
    }
}
