package ai.openapk.core.script;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.PrePersist;
import jakarta.persistence.PreUpdate;
import jakarta.persistence.Table;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;
import org.hibernate.annotations.JdbcTypeCode;
import org.hibernate.type.SqlTypes;

import java.time.Instant;
import java.util.UUID;

/**
 * Result of one script-worker Lambda invocation for a {@code SCRIPT}
 * project. Mirrors V30 migration. One row per project — re-analysis
 * updates in place rather than spawning siblings, because a SCRIPT
 * project owns a single tarball.
 *
 * <p>Storage split mirrors V22 BIN-passthrough: per-finding JSON in
 * Postgres for query/join/FTS, deobfuscated bundle in S3 served via
 * presigned URL to community readers.
 */
@Entity
@Table(name = "script_analyses")
@Getter
@Setter
@NoArgsConstructor
public class ScriptAnalysis {

    /** Project ID is the primary key — there's only one analysis per script project. */
    @Id
    @Column(name = "project_id")
    private UUID projectId;

    /**
     * Lambda's full findings.json — preserved verbatim. Schema-versioned;
     * v1 carries summary + findings[] (see script-worker/README.md).
     */
    @Column(name = "findings_jsonb", nullable = false, columnDefinition = "jsonb")
    @JdbcTypeCode(SqlTypes.JSON)
    private String findingsJson;

    /** S3 key for the deobfuscated tar.gz bundle. Null if the package had no JS files worth bundling. */
    @Column(name = "bundle_s3_key", length = 512)
    private String bundleS3Key;

    /**
     * Concatenated suspicious-snippet text, indexed via GIN tsvector for
     * the community search bar ("show me reports mentioning discord
     * webhooks"). Empty string when there are no findings.
     */
    @Column(name = "findings_text", nullable = false, columnDefinition = "text")
    private String findingsText = "";

    @Column(name = "package_name", length = 255)
    private String packageName;

    @Column(name = "package_version", length = 64)
    private String packageVersion;

    @Column(name = "finding_count", nullable = false)
    private int findingCount;

    @Column(name = "critical_count", nullable = false)
    private int criticalCount;

    @Column(name = "high_count", nullable = false)
    private int highCount;

    @Column(name = "medium_count", nullable = false)
    private int mediumCount;

    @Column(name = "info_count", nullable = false)
    private int infoCount;

    @Column(name = "duration_ms")
    private Integer durationMs;

    @Column(name = "analyzed_at", nullable = false)
    private Instant analyzedAt;

    @Column(name = "created_at", nullable = false, updatable = false)
    private Instant createdAt;

    @Column(name = "updated_at", nullable = false)
    private Instant updatedAt;

    @PrePersist
    void onCreate() {
        Instant now = Instant.now();
        if (createdAt == null) createdAt = now;
        if (updatedAt == null) updatedAt = now;
        if (analyzedAt == null) analyzedAt = now;
    }

    @PreUpdate
    void onUpdate() {
        updatedAt = Instant.now();
    }
}
