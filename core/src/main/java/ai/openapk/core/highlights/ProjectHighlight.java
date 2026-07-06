package ai.openapk.core.highlights;

import ai.openapk.core.auth.User;
import ai.openapk.core.projects.Project;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.EnumType;
import jakarta.persistence.Enumerated;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import jakarta.persistence.Id;
import jakarta.persistence.JoinColumn;
import jakarta.persistence.ManyToOne;
import jakarta.persistence.PrePersist;
import jakarta.persistence.Table;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;

import java.time.Instant;
import java.util.UUID;

/**
 * One card on a project's Highlights board. See {@link HighlightType}. The
 * {@code createdBy} attribution feeds the report contributor byline; it is
 * nullable so a highlight outlives the author's account (FK SET NULL).
 */
@Entity
@Table(name = "project_highlights")
@Getter
@Setter
@NoArgsConstructor
public class ProjectHighlight {

    @Id
    @GeneratedValue(strategy = GenerationType.UUID)
    private UUID id;

    @ManyToOne(optional = false)
    @JoinColumn(name = "project_id", nullable = false)
    private Project project;

    @Enumerated(EnumType.STRING)
    @Column(nullable = false, length = 16)
    private HighlightType type;

    @Column(name = "target_ref")
    private String targetRef;

    @Column(name = "media_key")
    private String mediaKey;

    @Column
    private String tag;

    @Column(columnDefinition = "TEXT")
    private String note;

    @Column(nullable = false)
    private int position;

    @ManyToOne
    @JoinColumn(name = "created_by")
    private User createdBy;

    @Column(name = "created_at", nullable = false)
    private Instant createdAt;

    @PrePersist
    void prePersist() {
        if (createdAt == null) createdAt = Instant.now();
    }
}
