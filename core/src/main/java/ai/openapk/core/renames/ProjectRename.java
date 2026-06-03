package ai.openapk.core.renames;

import ai.openapk.core.projects.Project;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.EnumType;
import jakarta.persistence.Enumerated;
import jakarta.persistence.FetchType;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import jakarta.persistence.Id;
import jakarta.persistence.JoinColumn;
import jakarta.persistence.ManyToOne;
import jakarta.persistence.PrePersist;
import jakarta.persistence.Table;
import jakarta.persistence.UniqueConstraint;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;

import java.time.Instant;
import java.util.UUID;

@Entity
@Table(name = "project_renames",
        uniqueConstraints = @UniqueConstraint(columnNames = {"project_id", "original"}))
@Getter
@Setter
@NoArgsConstructor
public class ProjectRename {

    @Id
    @GeneratedValue(strategy = GenerationType.UUID)
    private UUID id;

    @ManyToOne(fetch = FetchType.LAZY, optional = false)
    @JoinColumn(name = "project_id", nullable = false)
    private Project project;

    @Column(nullable = false)
    private String original;

    @Column(nullable = false)
    private String suggested;

    /** 'class' | 'method' | 'field' — informational, not enforced. */
    @Column(nullable = false)
    private String scope;

    @Enumerated(EnumType.STRING)
    @Column(nullable = false)
    private RenameStatus status;

    /** 'high' | 'medium' | 'low' — from the AI. */
    @Column(nullable = false)
    private String confidence;

    /** File path where the suggestion came from. Informational. */
    @Column(name = "source_path")
    private String sourcePath;

    @Column(columnDefinition = "TEXT")
    private String rationale;

    @Column(name = "created_at", nullable = false)
    private Instant createdAt;

    @PrePersist
    void prePersist() {
        if (createdAt == null) createdAt = Instant.now();
        if (status == null) status = RenameStatus.SUGGESTED;
    }
}
