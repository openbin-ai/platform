package ai.openapk.core.nativeanalysis;

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

@Entity
@Table(name = "native_analyses")
@Getter
@Setter
@NoArgsConstructor
public class NativeAnalysis {

    @Id
    @GeneratedValue(strategy = GenerationType.UUID)
    private UUID id;

    @Column(name = "project_id", nullable = false)
    private UUID projectId;

    /** Relative path under the project's srcDir, e.g. {@code resources/lib/arm64-v8a/libnative.so}. */
    @Column(name = "lib_path", nullable = false, length = 512)
    private String libPath;

    /** {@code arm64-v8a}, {@code armeabi-v7a}, {@code x86_64}, {@code x86}. */
    @Column(nullable = false, length = 32)
    private String arch;

    @Column(name = "size_bytes", nullable = false)
    private long sizeBytes;

    @Enumerated(EnumType.STRING)
    @Column(nullable = false, length = 32)
    private NativeAnalysisStatus status;

    /**
     * Worker's full extract: {@code {functions:[...], strings:[...], imports:[...], metadata:{...}}}.
     * Legacy path: populated synchronously by the (now-sunset) cloud Ghidra
     * executor. New rows go through the S3 ingest pipeline and leave this
     * column NULL; the body lives in S3 keyed by {@link #analysisS3Key}.
     */
    @Column(name = "result_jsonb", columnDefinition = "jsonb")
    @org.hibernate.annotations.JdbcTypeCode(org.hibernate.type.SqlTypes.JSON)
    private String resultJson;

    /**
     * S3 object key for the gzipped worker JSON, format
     * {@code analysis/native/{userUuid}/{projectUuid}/{libPathHash}/result.json.gz}.
     * Set by {@code /native/ingest/initiate} (row goes to INGEST_PENDING) and
     * confirmed by {@code /native/ingest/finalize} after the CLI has PUT to
     * S3. NULL for legacy rows whose body still lives in {@link #resultJson}.
     */
    @Column(name = "analysis_s3_key", length = 512)
    private String analysisS3Key;

    /** S3 ETag of the uploaded gzipped JSON — captured on finalize via HeadObject. */
    @Column(name = "analysis_s3_etag", length = 128)
    private String analysisS3Etag;

    /** Size of the gzipped S3 object in bytes — surfaces in the UI footer. */
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
        if (status == null) status = NativeAnalysisStatus.PENDING;
    }

    @PreUpdate
    void preUpdate() {
        updatedAt = Instant.now();
    }
}
