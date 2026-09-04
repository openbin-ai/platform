package ai.openapk.core.projects.samples;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.EnumType;
import jakarta.persistence.Enumerated;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
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
 * One ADDITIONAL sample attached to a BIN project (multi-sample projects).
 * The project's original binary stays on the {@code projects} row; extra
 * samples live here, one Ghidra worker blob each, mirroring
 * {@link ai.openapk.core.nativeanalysis.NativeAnalysis} (the per-project
 * child-analysis precedent).
 */
@Entity
@Table(name = "project_samples")
@Getter
@Setter
@NoArgsConstructor
public class ProjectSample {

    @Id
    @GeneratedValue(strategy = GenerationType.UUID)
    private UUID id;

    @Column(name = "project_id", nullable = false)
    private UUID projectId;

    /** Display label in the project's sample switcher (defaults to the filename). */
    @Column(nullable = false, length = 200)
    private String label;

    @Column(name = "original_filename", length = 512)
    private String originalFilename;

    @Column(nullable = false)
    private String sha256;

    @Column(name = "size_bytes", nullable = false)
    private long sizeBytes;

    // Ghidra-reported metadata, extracted at finalize.
    @Column(length = 64)
    private String arch;

    @Column(name = "executable_format", length = 128)
    private String executableFormat;

    @Column(length = 128)
    private String compiler;

    @Column(name = "language_id", length = 128)
    private String languageId;

    @Column(name = "image_base", length = 32)
    private String imageBase;

    @Enumerated(EnumType.STRING)
    @Column(nullable = false, length = 32)
    private ProjectSampleStatus status;

    /**
     * S3 key of the gzipped worker JSON:
     * {@code analysis/samples/{userUuid}/{projectUuid}/{sampleUuid}/result.json.gz}.
     */
    @Column(name = "analysis_s3_key", length = 512)
    private String analysisS3Key;

    @Column(name = "analysis_s3_etag", length = 128)
    private String analysisS3Etag;

    @Column(name = "analysis_size_bytes")
    private Long analysisSizeBytes;

    @Column(name = "error_message")
    private String errorMessage;

    @Column(name = "created_at", nullable = false)
    private Instant createdAt;

    @Column(name = "updated_at", nullable = false)
    private Instant updatedAt;

    @Column(name = "analyzed_at")
    private Instant analyzedAt;

    @PrePersist
    void prePersist() {
        Instant now = Instant.now();
        if (createdAt == null) createdAt = now;
        if (updatedAt == null) updatedAt = now;
        if (status == null) status = ProjectSampleStatus.INGEST_PENDING;
    }

    @PreUpdate
    void preUpdate() {
        updatedAt = Instant.now();
    }
}
