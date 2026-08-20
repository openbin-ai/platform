package ai.openapk.core.blog;

import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import java.util.List;
import java.util.UUID;

public interface PostVoteRepository extends JpaRepository<PostVote, PostVote.Id> {

    long countByPostId(UUID postId);

    /**
     * Which of these posts the viewer has already upvoted — one query for a
     * whole feed instead of an exists() per card.
     */
    @Query("SELECT v.post.id FROM PostVote v WHERE v.user.id = :userId AND v.post.id IN :postIds")
    List<UUID> postIdsVotedBy(@Param("userId") UUID userId, @Param("postIds") List<UUID> postIds);
}
