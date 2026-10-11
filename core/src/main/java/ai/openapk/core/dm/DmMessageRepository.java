package ai.openapk.core.dm;

import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import java.time.Instant;
import java.util.List;
import java.util.UUID;

public interface DmMessageRepository extends JpaRepository<DmMessage, UUID> {

    /** Newest-first page of a thread, optionally older than a cursor. */
    @Query("""
            SELECT msg FROM DmMessage msg JOIN FETCH msg.sender
            WHERE msg.conversation.id = :cid
              AND (CAST(:before AS timestamp) IS NULL OR msg.createdAt < :before)
            ORDER BY msg.createdAt DESC
            """)
    List<DmMessage> pageBefore(@Param("cid") UUID conversationId, @Param("before") Instant before, Pageable page);

    /** Messages newer than a cursor, oldest-first — the open thread's poll. */
    @Query("""
            SELECT msg FROM DmMessage msg JOIN FETCH msg.sender
            WHERE msg.conversation.id = :cid AND msg.createdAt > :after
            ORDER BY msg.createdAt ASC
            """)
    List<DmMessage> after(@Param("cid") UUID conversationId, @Param("after") Instant after, Pageable page);

    /** Unread = newer than my read cursor and not sent by me. */
    @Query("""
            SELECT COUNT(msg) FROM DmMessage msg
            WHERE msg.conversation.id = :cid
              AND msg.sender.id <> :uid
              AND (CAST(:since AS timestamp) IS NULL OR msg.createdAt > :since)
            """)
    long countUnread(@Param("cid") UUID conversationId, @Param("uid") UUID userId, @Param("since") Instant since);

    /**
     * Number of conversations with at least one unread message for the
     * badge — one query over the inbox instead of N countUnread calls.
     */
    @Query("""
            SELECT COUNT(DISTINCT m.conversation.id) FROM DmMember m
            WHERE m.user.id = :uid
              AND EXISTS (
                SELECT 1 FROM DmMessage msg
                WHERE msg.conversation.id = m.conversation.id
                  AND msg.sender.id <> :uid
                  AND (m.lastReadAt IS NULL OR msg.createdAt > m.lastReadAt)
              )
            """)
    long countConversationsWithUnread(@Param("uid") UUID userId);
}
