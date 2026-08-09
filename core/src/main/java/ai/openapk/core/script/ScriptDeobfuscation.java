package ai.openapk.core.script;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.Id;
import jakarta.persistence.PrePersist;
import jakarta.persistence.PreUpdate;
import jakarta.persistence.Table;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;

import java.time.Instant;
import java.util.UUID;

/**
 * A saved on-demand deobfuscation. Mirrors V38.
 *
 * <p>Distinct from the upload-time deobfuscated copies (which live in the
 * analysis bundle in S3): this is the result of an analyst pressing the
 * Deobfuscate button on one file with one engine, kept so it's still there
 * after a reload.
 *
 * <p>Unique on (project, file, engine) — re-running an engine overwrites
 * rather than appending, since the transform is deterministic.
 */
@Entity
@Table(name = "script_deobfuscations")
@Getter
@Setter
@NoArgsConstructor
public class ScriptDeobfuscation {

    @Id
    @GeneratedValue
    private UUID id;

    @Column(name = "project_id", nullable = false)
    private UUID projectId;

    @Column(name = "file_path", nullable = false, length = 512)
    private String filePath;

    /** Engine requested: auto | obfuscator-io | generic | caesar. */
    @Column(nullable = false, length = 32)
    private String engine;

    /** Engine actually used (differs from {@link #engine} only for auto). */
    @Column(name = "engine_used", nullable = false, length = 32)
    private String engineUsed;

    @Column(nullable = false, columnDefinition = "text")
    private String source;

    @Column(columnDefinition = "text")
    private String note;

    private Double score;

    @Column(name = "baseline_score")
    private Double baselineScore;

    @Column(nullable = false)
    private boolean truncated;

    @Column(name = "created_by")
    private UUID createdBy;

    @Column(name = "created_at", nullable = false, updatable = false)
    private Instant createdAt;

    @Column(name = "updated_at", nullable = false)
    private Instant updatedAt;

    @PrePersist
    void onCreate() {
        Instant now = Instant.now();
        if (createdAt == null) createdAt = now;
        if (updatedAt == null) updatedAt = now;
    }

    @PreUpdate
    void onUpdate() {
        updatedAt = Instant.now();
    }
}
