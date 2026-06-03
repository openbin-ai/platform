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
     * Same String + jsonb pattern used on {@link ai.openapk.core.projects.Project}.
     */
    @Column(name = "result_jsonb", columnDefinition = "jsonb")
    @org.hibernate.annotations.JdbcTypeCode(org.hibernate.type.SqlTypes.JSON)
    private String resultJson;

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
