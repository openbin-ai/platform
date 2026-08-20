package ai.openapk.core.blog;

import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import java.util.List;
import java.util.Optional;
import java.util.UUID;

public interface BlogPostRepository extends JpaRepository<BlogPost, UUID> {

    Optional<BlogPost> findBySlug(String slug);

    boolean existsBySlug(String slug);

    /** The public feed: published posts only, newest first. */
    List<BlogPost> findAllByPublishedAtIsNotNullOrderByPublishedAtDesc(Pageable pageable);

    /** An author's published posts — what a visitor sees on their profile. */
    List<BlogPost> findAllByAuthorIdAndPublishedAtIsNotNullOrderByPublishedAtDesc(UUID authorId);

    /** Everything the author owns, drafts included — their own dashboard. */
    List<BlogPost> findAllByAuthorIdOrderByCreatedAtDesc(UUID authorId);

    /**
     * Upvote counts for a batch of posts, so a feed of N posts costs one
     * query instead of N. Returns only posts with at least one vote; callers
     * default the rest to zero.
     */
    @Query("""
        SELECT v.post.id AS postId, COUNT(v) AS votes
        FROM PostVote v
        WHERE v.post.id IN :postIds
        GROUP BY v.post.id
    """)
    List<PostVoteCount> countVotesFor(@Param("postIds") List<UUID> postIds);

    /** Comment counts for a batch of posts. Soft-deleted comments don't count. */
    @Query("""
        SELECT c.post.id AS postId, COUNT(c) AS comments
        FROM ReportComment c
        WHERE c.post.id IN :postIds AND c.deletedAt IS NULL
        GROUP BY c.post.id
    """)
    List<PostCommentCount> countCommentsFor(@Param("postIds") List<UUID> postIds);

    interface PostVoteCount {
        UUID getPostId();
        long getVotes();
    }

    interface PostCommentCount {
        UUID getPostId();
        long getComments();
    }
}
