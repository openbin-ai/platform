package ai.openapk.core.reports;

import ai.openapk.core.projects.Project;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.FetchType;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import jakarta.persistence.Id;
import jakarta.persistence.JoinColumn;
import jakarta.persistence.OneToOne;
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

@Entity
@Table(name = "project_reports")
@Getter
@Setter
@NoArgsConstructor
public class ProjectReport {

    @Id
    @GeneratedValue(strategy = GenerationType.UUID)
    private UUID id;

    @OneToOne(fetch = FetchType.LAZY, optional = false)
    @JoinColumn(name = "project_id", nullable = false, unique = true)
    private Project project;

    @Column(nullable = false)
    private String title;

    /** JSON: {"sections":[{"id":"...","title":"...","content":"..."}]} */
    @Column(name = "sections_jsonb", columnDefinition = "jsonb", nullable = false)
    @org.hibernate.annotations.JdbcTypeCode(org.hibernate.type.SqlTypes.JSON)
    private String sectionsJson;

    @Column(name = "created_at", nullable = false)
    private Instant createdAt;

    @Column(name = "updated_at", nullable = false)
    private Instant updatedAt;

    /** Non-null = report is finalized (read-only) as of this instant. */
    @Column(name = "published_at")
    private Instant publishedAt;

    /**
     * Non-null = report is visible in the anonymous /community feed as of
     * this instant. Independent of {@link #publishedAt} — finalizing a
     * report doesn't expose it to the community automatically.
     */
    @Column(name = "community_published_at")
    private Instant communityPublishedAt;

    /**
     * STIX 2.1 malware-type open vocabulary value (ransomware, trojan,
     * backdoor, dropper, rootkit, wiper, worm, spyware, keylogger,
     * remote-access-trojan, downloader, screen-capture, webshell, virus,
     * exploit-kit, adware, botnet, bot, rogue-security-software, bootkit,
     * resource-exploitation, unknown). Enforced at the service layer; null
     * = author hasn't categorized.
     */
    @Column(name = "malware_type")
    private String malwareType;

    /**
     * Free-form tags. Postgres TEXT[]. Capped at 8 entries / 32 chars each
     * by the service layer. JdbcTypeCode mapping required to bridge
     * Postgres array ↔ Java String[].
     */
    @Column(name = "tags", columnDefinition = "text[]", nullable = false)
    @JdbcTypeCode(SqlTypes.ARRAY)
    private String[] tags = new String[0];

    @PrePersist
    void prePersist() {
        var now = Instant.now();
        if (createdAt == null) createdAt = now;
        updatedAt = now;
    }

    @PreUpdate
    void preUpdate() {
        updatedAt = Instant.now();
    }
}
