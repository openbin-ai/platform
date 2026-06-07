package ai.openapk.core.notifications;

import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import java.time.Instant;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

public interface NotificationRepository extends JpaRepository<Notification, UUID> {

    /** Bell-dropdown body: most recent first, capped via {@link Pageable}. */
    List<Notification> findByUser_IdOrderByCreatedAtDesc(UUID userId, Pageable page);

    /** Bell-badge count — uses the partial index on {@code read_at IS NULL}. */
    long countByUser_IdAndReadAtIsNull(UUID userId);

    /** Single fetch for the mark-read endpoint. */
    Optional<Notification> findByIdAndUser_Id(UUID id, UUID userId);

    /**
     * Bulk mark-read sweep used by {@code POST /api/notifications/read-all}.
     * Done in one UPDATE rather than fetch + save loop so the partial
     * unread index can stay tight without per-row overhead.
     */
    @Modifying
    @Query("UPDATE Notification n SET n.readAt = :ts WHERE n.user.id = :userId AND n.readAt IS NULL")
    int markAllRead(@Param("userId") UUID userId, @Param("ts") Instant ts);
}
