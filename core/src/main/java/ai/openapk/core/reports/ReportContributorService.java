package ai.openapk.core.reports;

import ai.openapk.core.auth.User;
import ai.openapk.core.projects.Project;
import ai.openapk.core.reports.dto.Contributor;
import jakarta.persistence.EntityManager;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.ArrayList;
import java.util.Collection;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;

/**
 * Builds and serves the contributor byline. The byline is contribution-based:
 * the project owner is the LEAD, and every distinct user who materially worked
 * the project — applied a rename, pinned a highlight, or last edited the
 * report body — is a CONTRIBUTOR, unless they've opted out of public credit
 * ({@code users.credit_publicly = false}). The owner is exempt from the
 * opt-out (publishing is their explicit public act).
 *
 * <p>Credits are snapshotted into {@code report_contributors} at publish time
 * (see {@link #snapshot}) so the public byline is stable; reads
 * ({@link #forReport}, {@link #forReports}) come straight from that table.
 */
@Service
public class ReportContributorService {

    private final EntityManager em;
    private final ReportContributorRepository repo;

    public ReportContributorService(EntityManager em, ReportContributorRepository repo) {
        this.em = em;
        this.repo = repo;
    }

    /**
     * Rebuild the frozen byline for a report. Idempotent — wipes and re-derives
     * every credit, so re-publishing after roster changes re-curates the list.
     * Call inside the publish transaction (owner + project must be loadable).
     */
    @Transactional
    public void snapshot(ProjectReport report) {
        repo.deleteByReportId(report.getId());

        Project project = report.getProject();
        User owner = project.getUser();

        List<ReportContributor> rows = new ArrayList<>();
        int position = 0;

        ReportContributor lead = new ReportContributor();
        lead.setReportId(report.getId());
        lead.setUserId(owner.getId());
        lead.setCredit("LEAD");
        lead.setDisplayName(CommunityService.displayNameOrFallback(owner.getDisplayName(), owner.getEmail()));
        lead.setEmailMd5(CommunityService.md5Hex(owner.getEmail()));
        lead.setPosition(position++);
        rows.add(lead);

        // Distinct contributors (excluding the owner + opted-out users) who
        // touched the project via any attributed surface. One flat union.
        var nq = em.createNativeQuery("""
                SELECT u.id, u.display_name, u.email
                FROM users u
                WHERE u.credit_publicly = TRUE
                  AND u.id <> :ownerId
                  AND u.id IN (
                      SELECT created_by FROM project_highlights
                          WHERE project_id = :pid AND created_by IS NOT NULL
                      UNION
                      SELECT applied_by FROM project_renames
                          WHERE project_id = :pid AND applied_by IS NOT NULL
                      UNION
                      SELECT updated_by FROM project_reports
                          WHERE id = :reportId AND updated_by IS NOT NULL
                  )
                ORDER BY u.display_name NULLS LAST
                """);
        nq.setParameter("ownerId", owner.getId());
        nq.setParameter("pid", project.getId());
        nq.setParameter("reportId", report.getId());

        @SuppressWarnings("unchecked")
        List<Object[]> contributors = nq.getResultList();
        for (Object[] c : contributors) {
            ReportContributor rc = new ReportContributor();
            rc.setReportId(report.getId());
            rc.setUserId((UUID) c[0]);
            rc.setCredit("CONTRIBUTOR");
            rc.setDisplayName(CommunityService.displayNameOrFallback((String) c[1], (String) c[2]));
            rc.setEmailMd5(CommunityService.md5Hex((String) c[2]));
            rc.setPosition(position++);
            rows.add(rc);
        }

        repo.saveAll(rows);
    }

    /** The byline for one report, LEAD first. Empty for unpublished / legacy reports. */
    @Transactional(readOnly = true)
    public List<Contributor> forReport(UUID reportId) {
        return repo.findByReportIdOrderByPositionAsc(reportId).stream().map(ReportContributorService::toDto).toList();
    }

    /**
     * Bylines for a page of reports, keyed by report id (each list LEAD-first).
     * One query for the whole page — feed/profile callers batch their row ids
     * through this instead of N per-report lookups.
     */
    @Transactional(readOnly = true)
    public Map<UUID, List<Contributor>> forReports(Collection<UUID> reportIds) {
        var out = new LinkedHashMap<UUID, List<Contributor>>();
        if (reportIds == null || reportIds.isEmpty()) return out;
        for (ReportContributor rc : repo.findByReportIdInOrderByReportIdAscPositionAsc(reportIds)) {
            out.computeIfAbsent(rc.getReportId(), k -> new ArrayList<>()).add(toDto(rc));
        }
        return out;
    }

    private static Contributor toDto(ReportContributor rc) {
        return new Contributor(rc.getUserId(), rc.getDisplayName(), rc.getEmailMd5(), rc.getCredit(), false);
    }
}
