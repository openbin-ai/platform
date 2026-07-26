package ai.openapk.core.bundles;

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
import jakarta.persistence.Table;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;

import java.time.Instant;
import java.util.UUID;

/**
 * A lightweight grouping of several standalone BIN {@link ai.openapk.core.projects.Project}
 * rows that belong to one real-world sample. The bundle owns only an editable
 * display name; each member project keeps its own analysis, dedup, fork,
 * publish and annotation state entirely independently. See V37__bundles.sql.
 */
@Entity
@Table(name = "bundles")
@Getter
@Setter
@NoArgsConstructor
public class Bundle {

    @Id
    @GeneratedValue(strategy = GenerationType.UUID)
    private UUID id;

    @ManyToOne(fetch = FetchType.LAZY, optional = false)
    @JoinColumn(name = "user_id", nullable = false)
    private User user;

    /** User-editable display name; seeded by the CLI from the folder / --bundle value. */
    @Column(nullable = false)
    private String name;

    @Column(name = "created_at", nullable = false)
    private Instant createdAt;

    @PrePersist
    void prePersist() {
        if (createdAt == null) createdAt = Instant.now();
        if (name == null || name.isBlank()) name = "bundle";
    }
}
