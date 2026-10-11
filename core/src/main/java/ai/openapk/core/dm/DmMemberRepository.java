package ai.openapk.core.dm;

import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import java.util.List;
import java.util.Optional;
import java.util.UUID;

public interface DmMemberRepository extends JpaRepository<DmMember, DmMember.Id> {

    Optional<DmMember> findByConversation_IdAndUser_Id(UUID conversationId, UUID userId);

    long countByConversation_Id(UUID conversationId);

    /**
     * Drop a user's read-cursor row in a project's chat when they leave the
     * roster, so the chat falls off their inbox. Access itself is enforced
     * against the roster, so this is tidy-up, not the security boundary.
     */
    @Modifying
    @Query("DELETE FROM DmMember m WHERE m.user.id = :uid AND m.conversation.id IN " +
           "(SELECT c.id FROM DmConversation c WHERE c.projectId = :pid)")
    void deleteProjectMembership(@Param("pid") UUID projectId, @Param("uid") UUID userId);

    /** Everyone in a conversation (2 rows for a DM). Users are eagerly joined for the DTO. */
    @Query("SELECT m FROM DmMember m JOIN FETCH m.user WHERE m.conversation.id = :cid")
    List<DmMember> findMembers(@Param("cid") UUID conversationId);

    /**
     * The caller's inbox: every membership, newest conversation activity
     * first (never-messaged conversations sort last). Conversation + the
     * row's own user are fetched in one go; the OTHER member is loaded per
     * row by the service (two small queries beat a self-join here).
     */
    @Query("""
            SELECT m FROM DmMember m JOIN FETCH m.conversation c
            WHERE m.user.id = :uid
            ORDER BY c.lastMessageAt DESC NULLS LAST, c.createdAt DESC
            """)
    List<DmMember> inbox(@Param("uid") UUID userId);
}
