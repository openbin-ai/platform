package ai.openapk.core.ctf;

import ai.openapk.core.projects.ProjectKind;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.EnumType;
import jakarta.persistence.Enumerated;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;

import java.time.Instant;
import java.util.UUID;

/**
 * One CTF challenge. The binary itself is a public project (so it can be
 * forked and worked on in the browser); this row carries the window, the
 * salted flag hash and the copy. Live while {@code startsAt <= now < endsAt};
 * solves after {@code endsAt} still count, at archive points.
 */
@Entity
@Table(name = "ctf_challenges")
@Getter
@Setter
@NoArgsConstructor
public class CtfChallenge {

    @Id
    private UUID id;

    @Column(nullable = false, unique = true)
    private String slug;

    @Column(nullable = false)
    private String title;

    @Column(nullable = false)
    private String description = "";

    @Enumerated(EnumType.STRING)
    @Column(nullable = false)
    private ProjectKind kind;

    @Column(name = "project_id")
    private UUID projectId;

    @Column(name = "created_by", nullable = false)
    private UUID createdBy;

    @Column(name = "flag_hash", nullable = false)
    private String flagHash;

    @Column(name = "flag_salt", nullable = false)
    private String flagSalt;

    @Column(name = "flag_hint")
    private String flagHint;

    @Column(name = "starts_at", nullable = false)
    private Instant startsAt;

    @Column(name = "ends_at", nullable = false)
    private Instant endsAt;

    @Column(nullable = false)
    private String season;

    @Column(name = "announced_at")
    private Instant announcedAt;

    @Column(name = "created_at", nullable = false)
    private Instant createdAt = Instant.now();

    @Column(name = "updated_at", nullable = false)
    private Instant updatedAt = Instant.now();

    public boolean isLive(Instant now) {
        return !now.isBefore(startsAt) && now.isBefore(endsAt);
    }

    public boolean hasStarted(Instant now) {
        return !now.isBefore(startsAt);
    }
}
