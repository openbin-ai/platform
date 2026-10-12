package ai.openapk.core.ctf;

import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import java.time.Instant;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

public interface CtfChallengeRepository extends JpaRepository<CtfChallenge, UUID> {

    Optional<CtfChallenge> findBySlug(String slug);

    /** The challenge whose window contains {@code now}; newest start wins if windows overlap. */
    @Query("SELECT c FROM CtfChallenge c WHERE c.startsAt <= :now AND c.endsAt > :now ORDER BY c.startsAt DESC")
    List<CtfChallenge> findLive(@Param("now") Instant now);

    @Query("SELECT c FROM CtfChallenge c WHERE c.startsAt > :now ORDER BY c.startsAt ASC")
    List<CtfChallenge> findUpcoming(@Param("now") Instant now);

    /** Everything that has started, newest first: the archive, with the live one on top. */
    @Query("SELECT c FROM CtfChallenge c WHERE c.startsAt <= :now ORDER BY c.startsAt DESC")
    List<CtfChallenge> findStarted(@Param("now") Instant now);

    @Query("SELECT c FROM CtfChallenge c WHERE c.startsAt <= :now AND c.announcedAt IS NULL")
    List<CtfChallenge> findStartedUnannounced(@Param("now") Instant now);

    List<CtfChallenge> findAllByOrderByStartsAtDesc();
}
