package ai.openapk.core.blog;

import ai.openapk.core.auth.User;
import ai.openapk.core.blog.dto.BlogPostDetail;
import ai.openapk.core.blog.dto.BlogPostRequest;
import ai.openapk.core.blog.dto.BlogPostSummary;
import ai.openapk.core.reports.CommunityService;
import ai.openapk.core.social.ReportCommentRepository;
import org.springframework.data.domain.PageRequest;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.server.ResponseStatusException;

import java.time.Instant;
import java.util.HashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.UUID;

/**
 * Blog posts: writing that stands on its own rather than analysing a project.
 *
 * <p>Drafts are private to their author. Publishing freezes the slug and makes
 * the post readable anonymously; unpublishing hides it again but keeps the
 * slug reserved, so a post that returns doesn't come back at a different URL
 * (and someone else can't claim the old one in the meantime).
 */
@Service
public class BlogService {

    /** Feed page size. Deliberately small — the cards carry summaries. */
    private static final int FEED_LIMIT = 30;

    /** Words per minute for the reading estimate. Conventional value. */
    private static final int WPM = 220;

    private final BlogPostRepository posts;
    private final PostVoteRepository votes;
    private final ReportCommentRepository comments;

    public BlogService(BlogPostRepository posts, PostVoteRepository votes,
                       ReportCommentRepository comments) {
        this.posts = posts;
        this.votes = votes;
        this.comments = comments;
    }

    // ─── reads ──────────────────────────────────────────────────────────

    /** Public feed, newest published first. */
    @Transactional(readOnly = true)
    public List<BlogPostSummary> feed(User viewerOrNull) {
        var page = posts.findAllByPublishedAtIsNotNullOrderByPublishedAtDesc(
                PageRequest.of(0, FEED_LIMIT));
        return summarize(page, viewerOrNull);
    }

    /** An author's published posts — shown on their public profile. */
    @Transactional(readOnly = true)
    public List<BlogPostSummary> byAuthor(UUID authorId, User viewerOrNull) {
        return summarize(posts.findAllByAuthorIdAndPublishedAtIsNotNullOrderByPublishedAtDesc(authorId),
                viewerOrNull);
    }

    /** Everything the caller owns, drafts included. */
    @Transactional(readOnly = true)
    public List<BlogPostSummary> mine(User author) {
        return summarize(posts.findAllByAuthorIdOrderByCreatedAtDesc(author.getId()), author);
    }

    /**
     * Read one post by slug. Drafts resolve only for their author — everyone
     * else gets the same 404 a nonexistent slug gives, so an unpublished
     * title can't be probed for.
     */
    @Transactional(readOnly = true)
    public BlogPostDetail bySlug(String slug, User viewerOrNull) {
        BlogPost post = posts.findBySlug(slug).orElseThrow(BlogService::notFound);
        boolean mine = viewerOrNull != null && viewerOrNull.getId().equals(post.getAuthor().getId());
        if (!post.isPublished() && !mine) throw notFound();
        return detail(post, viewerOrNull, mine);
    }

    // ─── writes ─────────────────────────────────────────────────────────

    /** Create a draft. Nothing is public until {@link #publish} runs. */
    @Transactional
    public BlogPostDetail create(User author, BlogPostRequest req) {
        BlogPost post = new BlogPost();
        post.setAuthor(author);
        post.setTitle(req.title().strip());
        post.setSummary(blankToNull(req.summary()));
        post.setBodyMd(req.bodyMd());
        post.setSlug(uniqueSlug(req.title()));
        return detail(posts.save(post), author, true);
    }

    @Transactional
    public BlogPostDetail update(User caller, UUID id, BlogPostRequest req) {
        BlogPost post = own(caller, id);
        post.setTitle(req.title().strip());
        post.setSummary(blankToNull(req.summary()));
        post.setBodyMd(req.bodyMd());
        // Slug intentionally NOT recomputed: it's the post's public identity
        // once published, and silently moving it breaks every shared link.
        return detail(posts.save(post), caller, true);
    }

    @Transactional
    public BlogPostDetail publish(User caller, UUID id, boolean publish) {
        BlogPost post = own(caller, id);
        if (publish && !post.isPublished()) {
            post.setPublishedAt(Instant.now());
        } else if (!publish) {
            post.setPublishedAt(null);
        }
        return detail(posts.save(post), caller, true);
    }

    @Transactional
    public void delete(User caller, UUID id) {
        posts.delete(own(caller, id));
    }

    /**
     * Toggle the caller's upvote. Returns the resulting count. Idempotent per
     * user by construction — the vote's key is (user, post).
     */
    @Transactional
    public long toggleUpvote(User voter, UUID postId) {
        BlogPost post = posts.findById(postId).orElseThrow(BlogService::notFound);
        if (!post.isPublished()) throw notFound();

        var id = new PostVote.Id(voter.getId(), postId);
        if (votes.existsById(id)) {
            votes.deleteById(id);
        } else {
            PostVote v = new PostVote();
            v.setId(id);
            v.setUser(voter);
            v.setPost(post);
            votes.save(v);
        }
        return votes.countByPostId(postId);
    }

    // ─── helpers ────────────────────────────────────────────────────────

    private BlogPost own(User caller, UUID id) {
        BlogPost post = posts.findById(id).orElseThrow(BlogService::notFound);
        if (!post.getAuthor().getId().equals(caller.getId())) {
            // 404 rather than 403 — same non-disclosure posture as projects.
            throw notFound();
        }
        return post;
    }

    /**
     * Batch the vote and comment counts so a 30-card feed costs three queries
     * instead of sixty-one.
     */
    private List<BlogPostSummary> summarize(List<BlogPost> page, User viewerOrNull) {
        if (page.isEmpty()) return List.of();
        List<UUID> ids = page.stream().map(BlogPost::getId).toList();

        Map<UUID, Long> voteCounts = new HashMap<>();
        for (var row : posts.countVotesFor(ids)) voteCounts.put(row.getPostId(), row.getVotes());
        Map<UUID, Long> commentCounts = new HashMap<>();
        for (var row : posts.countCommentsFor(ids)) commentCounts.put(row.getPostId(), row.getComments());

        UUID viewerId = viewerOrNull == null ? null : viewerOrNull.getId();
        var myVotes = viewerId == null ? List.<UUID>of() : votes.postIdsVotedBy(viewerId, ids);

        return page.stream().map(p -> new BlogPostSummary(
                p.getId(),
                p.getSlug(),
                p.getTitle(),
                summaryOrExcerpt(p),
                p.getAuthor().getId(),
                displayName(p.getAuthor()),
                CommunityService.md5Hex(p.getAuthor().getEmail()),
                p.getPublishedAt(),
                p.getUpdatedAt(),
                voteCounts.getOrDefault(p.getId(), 0L),
                commentCounts.getOrDefault(p.getId(), 0L),
                myVotes.contains(p.getId()),
                viewerId != null && viewerId.equals(p.getAuthor().getId()),
                !p.isPublished(),
                readingMinutes(p.getBodyMd())
        )).toList();
    }

    private BlogPostDetail detail(BlogPost p, User viewerOrNull, boolean mine) {
        UUID viewerId = viewerOrNull == null ? null : viewerOrNull.getId();
        User a = p.getAuthor();
        return new BlogPostDetail(
                p.getId(),
                p.getSlug(),
                p.getTitle(),
                p.getSummary(),
                p.getBodyMd(),
                a.getId(),
                displayName(a),
                CommunityService.md5Hex(a.getEmail()),
                a.getBio(),
                a.getWebsiteUrl(),
                a.getGithubUser(),
                a.getXUser(),
                a.getMastodonUrl(),
                a.getLinkedinUrl(),
                p.getCreatedAt(),
                p.getUpdatedAt(),
                p.getPublishedAt(),
                votes.countByPostId(p.getId()),
                viewerId != null && votes.existsById(new PostVote.Id(viewerId, p.getId())),
                mine,
                !p.isPublished(),
                readingMinutes(p.getBodyMd())
        );
    }

    /**
     * URL-safe slug from the title, uniquified with a short suffix on
     * collision. Two people writing "Unpacking a Loader" both get a working
     * URL rather than the second one failing to save.
     */
    String uniqueSlug(String title) {
        String base = slugify(title);
        if (!posts.existsBySlug(base)) return base;
        for (int i = 2; i < 50; i++) {
            String candidate = base + "-" + i;
            if (!posts.existsBySlug(candidate)) return candidate;
        }
        return base + "-" + UUID.randomUUID().toString().substring(0, 8);
    }

    /** Visible for testing. */
    static String slugify(String title) {
        String s = title == null ? "" : title.toLowerCase(Locale.ROOT).strip();
        // Strip accents so "Análisis" becomes "analisis" rather than vanishing.
        s = java.text.Normalizer.normalize(s, java.text.Normalizer.Form.NFD)
                .replaceAll("\\p{M}+", "");
        s = s.replaceAll("[^a-z0-9]+", "-").replaceAll("^-+|-+$", "");
        if (s.length() > 80) {
            s = s.substring(0, 80).replaceAll("-+$", "");
        }
        // A title of pure punctuation or non-Latin script leaves nothing
        // usable; fall back to something that still routes.
        return s.isBlank() ? "post-" + UUID.randomUUID().toString().substring(0, 8) : s;
    }

    /** Visible for testing. */
    static int readingMinutes(String body) {
        if (body == null || body.isBlank()) return 1;
        int words = body.trim().split("\\s+").length;
        return Math.max(1, (int) Math.ceil(words / (double) WPM));
    }

    private static String summaryOrExcerpt(BlogPost p) {
        if (p.getSummary() != null && !p.getSummary().isBlank()) return p.getSummary();
        return excerpt(p.getBodyMd());
    }

    /** Visible for testing. First readable prose, stripped of markdown noise. */
    static String excerpt(String body) {
        if (body == null) return "";
        String text = body
                .replaceAll("(?s)```.*?```", " ")     // fenced code
                .replaceAll("!\\[[^\\]]*\\]\\([^)]*\\)", " ")   // images
                .replaceAll("\\[([^\\]]*)\\]\\([^)]*\\)", "$1") // links -> text
                .replaceAll("[#>*_`~]", " ")
                .replaceAll("\\s+", " ")
                .strip();
        return text.length() <= 200 ? text : text.substring(0, 200).stripTrailing() + "…";
    }

    private static String displayName(User u) {
        if (u.getDisplayName() != null && !u.getDisplayName().isBlank()) return u.getDisplayName();
        String email = u.getEmail();
        if (email != null && email.contains("@")) return email.substring(0, email.indexOf('@'));
        return "anonymous researcher";
    }

    private static String blankToNull(String s) {
        return (s == null || s.isBlank()) ? null : s.strip();
    }

    private static ResponseStatusException notFound() {
        return new ResponseStatusException(HttpStatus.NOT_FOUND, "post not found");
    }
}
