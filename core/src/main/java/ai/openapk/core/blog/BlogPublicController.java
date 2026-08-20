package ai.openapk.core.blog;

import ai.openapk.core.auth.CurrentUserService;
import ai.openapk.core.blog.dto.BlogPostDetail;
import ai.openapk.core.blog.dto.BlogPostSummary;
import ai.openapk.core.social.CommentsService;
import ai.openapk.core.social.dto.CommentResponse;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import java.util.List;
import java.util.UUID;

/**
 * Anonymous reads for blog posts. Mounted under /api/community/** which
 * SecurityConfig permits without auth, so a shared post link works for a
 * logged-out visitor — the same posture the community report pages have.
 *
 * <p>Reads are personalized when a token happens to be present
 * ({@code currentOrNull}), which is what drives "you already upvoted this"
 * without forcing a sign-in wall on the reader.
 */
@RestController
@RequestMapping("/api/community/blog")
public class BlogPublicController {

    private final BlogService service;
    private final CommentsService comments;
    private final CurrentUserService currentUser;

    public BlogPublicController(BlogService service, CommentsService comments,
                                CurrentUserService currentUser) {
        this.service = service;
        this.comments = comments;
        this.currentUser = currentUser;
    }

    @GetMapping
    public List<BlogPostSummary> feed() {
        return service.feed(currentUser.currentOrNull());
    }

    @GetMapping("/authors/{authorId}")
    public List<BlogPostSummary> byAuthor(@PathVariable UUID authorId) {
        return service.byAuthor(authorId, currentUser.currentOrNull());
    }

    @GetMapping("/{slug}")
    public BlogPostDetail post(@PathVariable String slug) {
        return service.bySlug(slug, currentUser.currentOrNull());
    }

    @GetMapping("/{slug}/comments")
    public List<CommentResponse> comments(@PathVariable String slug,
                                          @RequestParam(defaultValue = "hot") String sort) {
        // Resolve the slug first so the thread 404s exactly like the post does
        // (drafts included) rather than returning an empty list.
        BlogPostDetail post = service.bySlug(slug, currentUser.currentOrNull());
        return comments.listForPost(post.id(), currentUser.currentOrNull(), sort);
    }
}
