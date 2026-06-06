package ai.openapk.core.social;

import org.springframework.data.jpa.repository.JpaRepository;

import java.util.UUID;

public interface FollowRepository extends JpaRepository<Follow, Follow.Id> {

    /** Profile-page badge: how many people follow this user. */
    long countByFolloweeId(UUID followeeId);

    /** Profile-page badge: how many people this user follows. */
    long countByFollowerId(UUID followerId);

    /**
     * Used by the report-detail "follow author" button to render initial
     * state. Vote count is fine to roll up server-side, but follow state
     * is per-viewer so we need an explicit existence check.
     */
    boolean existsByFollowerIdAndFolloweeId(UUID followerId, UUID followeeId);
}
