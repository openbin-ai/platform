package ai.openapk.core.auth;

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

@Entity
@Table(name = "users")
@Getter
@Setter
@NoArgsConstructor
public class User {

    @Id
    @GeneratedValue(strategy = GenerationType.UUID)
    private UUID id;

    @Column(name = "keycloak_sub", nullable = false, unique = true)
    private String keycloakSub;

    @Column
    private String email;

    @Column(name = "display_name")
    private String displayName;

    @Column(name = "created_at", nullable = false)
    private Instant createdAt;

    @Column(name = "last_seen_at", nullable = false)
    private Instant lastSeenAt;

    /**
     * Version string of the TOS the user has accepted. Compared against
     * {@code openapk.tos.current-version} in {@code TosAcceptanceFilter};
     * mismatch (or null) trips a 412 on protected endpoints. Bumped when
     * material TOS terms change so every account must re-accept before
     * the next API call lands.
     */
    @Column(name = "tos_accepted_version")
    private String tosAcceptedVersion;

    @Column(name = "tos_accepted_at")
    private Instant tosAcceptedAt;

    /**
     * Global "credit me publicly" flag. When false, the user is omitted from
     * the public contributor byline of reports they helped with (their work
     * still counts internally). Defaults true. The project OWNER is exempt —
     * publishing to the community feed is their explicit act.
     */
    @Column(name = "credit_publicly", nullable = false)
    private boolean creditPublicly = true;

    @PrePersist
    void prePersist() {
        var now = Instant.now();
        if (createdAt == null) createdAt = now;
        if (lastSeenAt == null) lastSeenAt = now;
    }
}
