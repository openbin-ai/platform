package ai.openapk.core.reports;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import jakarta.persistence.Id;
import jakarta.persistence.PrePersist;
import jakarta.persistence.Table;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;

import java.time.Instant;
import java.util.UUID;

/**
 * One frozen byline credit for a published report. Rebuilt from scratch each
 * time the report is (re)published to the community, so the public byline is a
 * stable snapshot — later roster or display-name changes don't silently
 * rewrite an already-published report's credits. {@code displayName} /
 * {@code emailMd5} are snapshotted so the credit renders even if the account
 * is later renamed or deleted ({@code userId} then goes NULL via the FK).
 */
@Entity
@Table(name = "report_contributors")
@Getter
@Setter
@NoArgsConstructor
public class ReportContributor {

    @Id
    @GeneratedValue(strategy = GenerationType.UUID)
    private UUID id;

    @Column(name = "report_id", nullable = false)
    private UUID reportId;

    @Column(name = "user_id")
    private UUID userId;

    /** LEAD | CONTRIBUTOR. */
    @Column(nullable = false)
    private String credit;

    @Column(name = "display_name")
    private String displayName;

    @Column(name = "email_md5")
    private String emailMd5;

    @Column(nullable = false)
    private int position;

    @Column(name = "created_at", nullable = false)
    private Instant createdAt;

    @PrePersist
    void prePersist() {
        if (createdAt == null) createdAt = Instant.now();
    }
}
