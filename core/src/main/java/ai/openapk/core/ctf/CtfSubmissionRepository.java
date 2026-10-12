package ai.openapk.core.ctf;

import org.springframework.data.jpa.repository.JpaRepository;

import java.time.Instant;
import java.util.UUID;

public interface CtfSubmissionRepository extends JpaRepository<CtfSubmission, UUID> {
    long countByUserIdAndSubmittedAtAfter(UUID userId, Instant after);
    long countByChallengeId(UUID challengeId);
}
