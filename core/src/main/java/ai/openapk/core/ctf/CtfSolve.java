package ai.openapk.core.ctf;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;

import java.time.Instant;
import java.util.UUID;

/** A correct flag. {@code rank} 1 is first blood; 0 means solved after the window closed. */
@Entity
@Table(name = "ctf_solves")
@Getter
@Setter
@NoArgsConstructor
public class CtfSolve {

    @Id
    private UUID id;

    @Column(name = "challenge_id", nullable = false)
    private UUID challengeId;

    @Column(name = "user_id", nullable = false)
    private UUID userId;

    @Column(name = "team_id")
    private UUID teamId;

    @Column(name = "solved_at", nullable = false)
    private Instant solvedAt = Instant.now();

    @Column(nullable = false)
    private int rank;

    @Column(nullable = false)
    private int points;

    @Column(name = "ai_assisted", nullable = false)
    private boolean aiAssisted;

    @Column(name = "writeup_project_id")
    private UUID writeupProjectId;
}
