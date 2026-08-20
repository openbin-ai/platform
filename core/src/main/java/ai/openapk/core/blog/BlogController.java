package ai.openapk.core.blog;

import ai.openapk.core.auth.CurrentUserService;
import ai.openapk.core.blog.dto.BlogPostDetail;
import ai.openapk.core.blog.dto.BlogPostRequest;
import ai.openapk.core.blog.dto.BlogPostSummary;
import jakarta.validation.Valid;
import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;

import java.util.List;
import java.util.Map;
import java.util.UUID;

/**
 * Authoring surface for blog posts — everything here requires auth
 * (/api/** is authenticated by default in SecurityConfig). Anonymous reads
 * live on {@link BlogPublicController} under /api/community/blog/**.
 */
@RestController
@RequestMapping("/api/blog")
public class BlogController {

    private final BlogService service;
    private final CurrentUserService currentUser;

    public BlogController(BlogService service, CurrentUserService currentUser) {
        this.service = service;
        this.currentUser = currentUser;
    }

    /** The caller's own posts, drafts included. */
    @GetMapping
    public List<BlogPostSummary> mine() {
        return service.mine(currentUser.current());
    }

    @PostMapping
    @ResponseStatus(HttpStatus.CREATED)
    public BlogPostDetail create(@Valid @RequestBody BlogPostRequest req) {
        return service.create(currentUser.current(), req);
    }

    @PutMapping("/{id}")
    public BlogPostDetail update(@PathVariable UUID id, @Valid @RequestBody BlogPostRequest req) {
        return service.update(currentUser.current(), id, req);
    }

    /** {@code POST /api/blog/{id}/publish?publish=false} to unpublish. */
    @PostMapping("/{id}/publish")
    public BlogPostDetail publish(@PathVariable UUID id,
                                  @RequestParam(defaultValue = "true") boolean publish) {
        return service.publish(currentUser.current(), id, publish);
    }

    @DeleteMapping("/{id}")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    public void delete(@PathVariable UUID id) {
        service.delete(currentUser.current(), id);
    }

    /** Toggle the caller's upvote; returns the new count. */
    @PostMapping("/{id}/upvote")
    public Map<String, Object> upvote(@PathVariable UUID id) {
        long count = service.toggleUpvote(currentUser.current(), id);
        return Map.of("upvotes", count);
    }
}
