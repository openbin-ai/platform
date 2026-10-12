package ai.openapk.core.ctf;

import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import java.util.List;
import java.util.Optional;
import java.util.UUID;

public interface CtfSolveRepository extends JpaRepository<CtfSolve, UUID> {

    Optional<CtfSolve> findByChallengeIdAndUserId(UUID challengeId, UUID userId);

    /** Ranked solves first (by rank), then archive solves by time. */
    @Query("SELECT s FROM CtfSolve s WHERE s.challengeId = :c ORDER BY CASE WHEN s.rank = 0 THEN 1 ELSE 0 END, s.rank, s.solvedAt")
    List<CtfSolve> findByChallengeOrdered(@Param("c") UUID challengeId);

    long countByChallengeIdAndRankGreaterThan(UUID challengeId, int rank);

    long countByChallengeId(UUID challengeId);

    Optional<CtfSolve> findByChallengeIdAndRank(UUID challengeId, int rank);

    List<CtfSolve> findByUserIdOrderBySolvedAtDesc(UUID userId);

    /**
     * Leaderboard rows: one per user with points, solves and first bloods.
     * {@code season} null means all time. Projection order matters: the
     * service maps it positionally.
     */
    @Query(value = """
            SELECT s.user_id, u.display_name, u.email,
                   SUM(s.points) AS points,
                   COUNT(*) AS solves,
                   COUNT(*) FILTER (WHERE s.rank = 1) AS first_bloods,
                   MIN(s.solved_at) AS first_solve
            FROM ctf_solves s
            JOIN ctf_challenges c ON c.id = s.challenge_id
            JOIN users u ON u.id = s.user_id
            WHERE (:season IS NULL OR c.season = :season)
            GROUP BY s.user_id, u.display_name, u.email
            ORDER BY points DESC, first_bloods DESC, first_solve ASC
            LIMIT :limit
            """, nativeQuery = true)
    List<Object[]> leaderboard(@Param("season") String season, @Param("limit") int limit);

    @Query(value = """
            SELECT COALESCE(SUM(points), 0), COUNT(*), COUNT(*) FILTER (WHERE rank = 1)
            FROM ctf_solves WHERE user_id = :u
            """, nativeQuery = true)
    Object[] statsForUser(@Param("u") UUID userId);
}
