package ai.openapk.core.projects;

import ai.openapk.core.analysis.AnalysisMode;
import ai.openapk.core.auth.User;
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
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;

import java.time.Instant;
import java.util.UUID;

@Entity
@Table(name = "projects")
@Getter
@Setter
@NoArgsConstructor
public class Project {

    @Id
    @GeneratedValue(strategy = GenerationType.UUID)
    private UUID id;

    @ManyToOne(fetch = FetchType.LAZY, optional = false)
    @JoinColumn(name = "user_id", nullable = false)
    private User user;

    /**
     * Discriminates APK projects (jadx pipeline) from BIN projects (Ghidra
     * pipeline). Set on upload and immutable thereafter. Drives which fields
     * below are populated, and which frontend views the project supports.
     */
    @Enumerated(EnumType.STRING)
    @Column(nullable = false)
    private ProjectKind kind;

    @Column(name = "original_filename", nullable = false)
    private String originalFilename;

    /** User-editable display name. Defaults to {@link #originalFilename} on upload. */
    @Column(nullable = false)
    private String name;

    @Column(name = "size_bytes", nullable = false)
    private long sizeBytes;

    @Column(nullable = false)
    private String sha256;

    @Enumerated(EnumType.STRING)
    @Column(nullable = false)
    private ProjectStatus status;

    /** Case-management state — see {@link WorkflowStatus}. */
    @Enumerated(EnumType.STRING)
    @Column(name = "workflow_status", nullable = false)
    private WorkflowStatus workflowStatus;

    /**
     * Project-level primary analysis mode. Drives the Report tab's default
     * section template (MAR vs VRR) and the AnalysisTab's mode dropdown
     * default. Per-call mode override is still possible via the analyze
     * request body; this is the project's persistent preference.
     */
    @Enumerated(EnumType.STRING)
    @Column(name = "analysis_mode", nullable = false)
    private AnalysisMode analysisMode;

    @Column(name = "error_message")
    private String errorMessage;

    @Column(name = "package_name")
    private String packageName;

    // ---- BIN-only metadata (NULL for APK projects) -------------------------
    // Populated from the Ghidra worker's `metadata` block when a BIN project
    // finishes analysis. See V16__project_kind_and_binary_metadata.sql.

    /** Caller-supplied or Ghidra-detected, e.g. "x86_64", "arm64-v8a", "auto". */
    @Column(name = "arch")
    private String arch;

    /** Ghidra's executable-format label, e.g. "ELF", "PE", "Mach-O". */
    @Column(name = "executable_format")
    private String executableFormat;

    /** Ghidra's compiler-spec guess, e.g. "gcc", "windows". */
    @Column(name = "compiler")
    private String compiler;

    /** Ghidra language ID, e.g. "x86:LE:64:default". */
    @Column(name = "language_id")
    private String languageId;

    /** Load address as a hex string, surfaced as-is in the UI. */
    @Column(name = "image_base")
    private String imageBase;

    @Column(name = "created_at", nullable = false)
    private Instant createdAt;

    /**
     * Non-null = the project's READ workspace (analysis, highlights, report)
     * is exposed to anonymous viewers via /api/public/projects/{id}/** as of
     * this instant. NULL = private (default). Independent of the report's
     * community_published_at — a project can be publicly browsable without a
     * report being in the community feed, and vice versa.
     */
    @Column(name = "public_read_at")
    private Instant publicReadAt;

    /**
     * Source project this was forked from, or null for an original. A fork
     * SHARES the source's {@code binary_analysis_s3_key} read-only and starts
     * with an empty renames/highlights/report layer. ON DELETE SET NULL (see
     * V35): deleting the source orphans forks into roots rather than destroying
     * them; the shared blob survives via refcounting in {@code ProjectService.delete}.
     */
    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "forked_from")
    private Project forkedFrom;

    /** Denormalized count of direct forks; maintained by fork/delete. */
    @Column(name = "fork_count", nullable = false)
    private int forkCount = 0;

    @Column(name = "decompiled_at")
    private Instant decompiledAt;

    /**
     * Coarse pipeline phase, updated as the decompile runs. Used by the
     * Projects list UI to show progress beyond a static "decompiling" chip.
     * Values: OPENING_APK, DECOMPILING, BUILDING_TREE, INDEXING_SYMBOLS,
     * INDEXING_USAGES. Cleared (left as-is) once status flips to READY.
     */
    @Column(name = "decompile_phase")
    private String decompilePhase;

    /** Timestamp of the first phase write — UI computes elapsed-time from it. */
    @Column(name = "decompile_started_at")
    private Instant decompileStartedAt;

    /**
     * Static digest JSON cached after the first /analyze call. We use String + a custom
     * Postgres cast (::jsonb) at write time rather than a JPA jsonb type to avoid
     * dragging in extra Hibernate type dependencies. Read as raw JSON string.
     */
    @Column(name = "digest_jsonb", columnDefinition = "jsonb")
    @org.hibernate.annotations.JdbcTypeCode(org.hibernate.type.SqlTypes.JSON)
    private String digestJson;

    /** Latest /analyze response, persisted so the report editor can populate sections without re-spending tokens. */
    @Column(name = "latest_analysis_jsonb", columnDefinition = "jsonb")
    @org.hibernate.annotations.JdbcTypeCode(org.hibernate.type.SqlTypes.JSON)
    private String latestAnalysisJson;

    /**
     * Cached symbol index — class / method / field declarations across the
     * project's src tree. Usages are NOT cached here (live-grepped on query).
     * Rebuilt lazily on first symbol query and on the Rescan endpoint.
     */
    @Column(name = "symbol_index_jsonb", columnDefinition = "jsonb")
    @org.hibernate.annotations.JdbcTypeCode(org.hibernate.type.SqlTypes.JSON)
    private String symbolIndexJson;

    /**
     * Nested FileNode JSON for the decompile output, built once when JADX
     * finishes. NULL until populated. Cleared (set to NULL) on re-decompile
     * so a fresh JADX run rebuilds it.
     */
    @Column(name = "file_tree_jsonb", columnDefinition = "jsonb")
    @org.hibernate.annotations.JdbcTypeCode(org.hibernate.type.SqlTypes.JSON)
    private String fileTreeJson;

    /**
     * Cached JNI bridge scan — loader call sites, native method declarations,
     * and the .so functions they were matched to. Built lazily on first
     * Native tab open; refreshed on Rescan or after a new .so finishes
     * analysis (since fresh function symbols may unlock new JNI matches).
     */
    @Column(name = "jni_bridge_jsonb", columnDefinition = "jsonb")
    @org.hibernate.annotations.JdbcTypeCode(org.hibernate.type.SqlTypes.JSON)
    private String jniBridgeJson;

    /**
     * BIN-only: full extract JSON from the Ghidra worker — functions (with
     * decompiled C and disassembly), strings, imports, metadata. Legacy
     * path: stored inline as JSONB. New path (Phase 1+): stored in S3 and
     * referenced by {@link #binaryAnalysisS3Key}. Either field can be set;
     * ProjectResponse prefers S3 and falls back to JSONB.
     */
    @Column(name = "binary_analysis_jsonb", columnDefinition = "jsonb")
    @org.hibernate.annotations.JdbcTypeCode(org.hibernate.type.SqlTypes.JSON)
    private String binaryAnalysisJson;

    /**
     * S3 object key for the gzipped worker JSON, format
     * {@code analysis/{userUuid}/{projectUuid}/result.json.gz}. Set by
     * /ingest/initiate (where the row is pre-created in INGEST_PENDING)
     * and confirmed by /ingest/finalize after the CLI has PUT to S3.
     * NULL for legacy projects whose body still lives in
     * {@link #binaryAnalysisJson}.
     */
    @Column(name = "binary_analysis_s3_key")
    private String binaryAnalysisS3Key;

    /**
     * S3 ETag of the uploaded object — captured on finalize via HeadObject.
     * Used as a cheap integrity check (does S3 still have what we expected)
     * and as a cache-buster for the CloudFront signed URL the frontend
     * fetches.
     */
    @Column(name = "binary_analysis_s3_etag")
    private String binaryAnalysisS3Etag;

    /** Size of the gzipped S3 object in bytes — surfaces in the UI footer. */
    @Column(name = "binary_analysis_size_bytes")
    private Long binaryAnalysisSizeBytes;

    @PrePersist
    void prePersist() {
        if (createdAt == null) createdAt = Instant.now();
        if (status == null) status = ProjectStatus.UPLOADED;
        if (workflowStatus == null) workflowStatus = WorkflowStatus.NEW;
        if (analysisMode == null) analysisMode = AnalysisMode.MALWARE;
        if (kind == null) kind = ProjectKind.APK;
        if (name == null || name.isBlank()) name = originalFilename;
    }
}
