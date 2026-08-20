package ai.openapk.core.blog;

import ai.openapk.core.auth.User;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.FetchType;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import jakarta.persistence.Id;
import jakarta.persistence.JoinColumn;
import jakarta.persistence.ManyToOne;
import jakarta.persistence.PrePersist;
import jakarta.persistence.PreUpdate;
import jakarta.persistence.Table;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;

import java.time.Instant;
import java.util.UUID;

/**
 * A standalone post — writing that isn't the analysis of a project.
 *
 * <p>Deliberately NOT a {@code ProjectReport}: reports are 1:1 with a project
 * and the whole community feed joins through that association. See V40.
 *
 * <p>The body is markdown, rendered client-side by the same component that
 * renders report sections, so a post gets the same syntax highlighting. It is
 * stored raw: react-markdown escapes HTML unless {@code rehype-raw} is added
 * (it isn't), which is the same posture report content has always had.
 */
@Entity
@Table(name = "blog_posts")
@Getter
@Setter
@NoArgsConstructor
public class BlogPost {

    @Id
    @GeneratedValue(strategy = GenerationType.UUID)
    private UUID id;

    @ManyToOne(fetch = FetchType.LAZY, optional = false)
    @JoinColumn(name = "author_id", nullable = false)
    private User author;

    @Column(nullable = false)
    private String title;

    /**
     * Public identifier in the URL. Assigned at first publish and frozen
     * thereafter — a slug that follows title edits silently breaks every
     * link anyone has shared.
     */
    @Column(nullable = false, unique = true)
    private String slug;

    /** Feed teaser. Null falls back to an excerpt of the body. */
    @Column
    private String summary;

    @Column(name = "body_md", nullable = false)
    private String bodyMd;

    @Column(name = "created_at", nullable = false)
    private Instant createdAt;

    @Column(name = "updated_at", nullable = false)
    private Instant updatedAt;

    /** Non-null = publicly visible as of this instant. Null = draft. */
    @Column(name = "published_at")
    private Instant publishedAt;

    public boolean isPublished() {
        return publishedAt != null;
    }

    @PrePersist
    void prePersist() {
        Instant now = Instant.now();
        if (createdAt == null) createdAt = now;
        if (updatedAt == null) updatedAt = now;
    }

    @PreUpdate
    void preUpdate() {
        updatedAt = Instant.now();
    }
}
