package ai.openapk.core.credentials;

import ai.openapk.core.auth.User;
import jakarta.persistence.Column;
import jakarta.persistence.Convert;
import jakarta.persistence.Entity;
import jakarta.persistence.FetchType;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import jakarta.persistence.Id;
import jakarta.persistence.JoinColumn;
import jakarta.persistence.ManyToOne;
import jakarta.persistence.PrePersist;
import jakarta.persistence.Table;
import jakarta.persistence.UniqueConstraint;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;

import java.time.Instant;
import java.util.UUID;

@Entity
@Table(name = "llm_credentials", uniqueConstraints = {
        @UniqueConstraint(columnNames = {"user_id", "label"})
})
@Getter
@Setter
@NoArgsConstructor
public class LlmCredential {

    @Id
    @GeneratedValue(strategy = GenerationType.UUID)
    private UUID id;

    @ManyToOne(fetch = FetchType.LAZY, optional = false)
    @JoinColumn(name = "user_id", nullable = false)
    private User user;

    @Convert(converter = LlmProviderConverter.class)
    @Column(nullable = false)
    private LlmProvider provider;

    @Column(nullable = false)
    private String label;

    @Column(name = "payload_ciphertext", nullable = false)
    private byte[] payloadCiphertext;

    @Column(name = "payload_iv", nullable = false)
    private byte[] payloadIv;

    @Column(name = "created_at", nullable = false)
    private Instant createdAt;

    @Column(name = "last_used_at")
    private Instant lastUsedAt;

    @Column(name = "last_test_status")
    private String lastTestStatus;

    @Column(name = "last_test_message")
    private String lastTestMessage;

    @Column(name = "last_test_at")
    private Instant lastTestAt;

    @PrePersist
    void prePersist() {
        if (createdAt == null) createdAt = Instant.now();
    }
}
