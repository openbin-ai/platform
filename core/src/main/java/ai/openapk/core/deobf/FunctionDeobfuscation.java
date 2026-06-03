package ai.openapk.core.deobf;

import ai.openapk.core.projects.Project;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
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

/**
 * AI-cleaned version of one obfuscated function. The original decompiled
 * text stays in the analysis JSON untouched — chain/xref/network/rename
 * indexers continue to read from there — so the deobf row is purely a
 * view-layer overlay. {@code originalName} is keyed pre-rename so the row
 * remains addressable after the user accepts a rename suggestion.
 */
@Entity
@Table(name = "function_deobfuscations",
        uniqueConstraints = @UniqueConstraint(columnNames = {"project_id", "original_name"}))
@Getter
@Setter
@NoArgsConstructor
public class FunctionDeobfuscation {

    @Id
    @GeneratedValue(strategy = GenerationType.UUID)
    private UUID id;

    @ManyToOne(fetch = FetchType.LAZY, optional = false)
    @JoinColumn(name = "project_id", nullable = false)
    private Project project;

    @Column(name = "original_name", nullable = false)
    private String originalName;

    @Column(nullable = false, columnDefinition = "TEXT")
    private String deobfuscated;

    @Column(columnDefinition = "TEXT")
    private String explanation;

    @Column(nullable = false)
    private String model;

    @Column(name = "input_tokens", nullable = false)
    private int inputTokens;

    @Column(name = "output_tokens", nullable = false)
    private int outputTokens;

    @Column(name = "created_at", nullable = false)
    private Instant createdAt;

    @PrePersist
    void prePersist() {
        if (createdAt == null) createdAt = Instant.now();
    }
}
