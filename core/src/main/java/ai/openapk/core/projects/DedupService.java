package ai.openapk.core.projects;

import ai.openapk.core.projects.dto.DedupMatch;
import ai.openapk.core.reports.CommunityService;
import jakarta.persistence.EntityManager;
import jakarta.persistence.PersistenceContext;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.ArrayList;
import java.util.List;
import java.util.UUID;
import java.util.regex.Pattern;

/**
 * Hash-based dedup lookup. Given a binary's sha256 (which the CLI already
 * computes + ships), returns PUBLIC projects with that hash so the CLI can
 * offer to fork an existing public analysis instead of re-decompiling.
 *
 * <p>Strictly public-only ({@code public_read_at IS NOT NULL}): matching never
 * reveals that some other user privately holds the same sample. Ordered
 * most-upvoted first so the canonical/most-trusted analysis surfaces at the top.
 */
@Service
public class DedupService {

    private static final Pattern SHA256 = Pattern.compile("[0-9a-fA-F]{64}");

    @PersistenceContext
    private EntityManager em;

    /** Public projects with this exact sha256, most-upvoted first (max 10). */
    @Transactional(readOnly = true)
    public List<DedupMatch> findPublicByHash(String sha256) {
        if (sha256 == null || !SHA256.matcher(sha256).matches()) return List.of();

        var nq = em.createNativeQuery("""
                SELECT p.id, p.name, u.display_name, u.email,
                       COALESCE((SELECT COUNT(*) FROM report_votes v
                                 JOIN project_reports r ON v.report_id = r.id
                                 WHERE r.project_id = p.id), 0) AS votes
                FROM projects p
                JOIN users u ON p.user_id = u.id
                WHERE p.public_read_at IS NOT NULL
                  AND lower(p.sha256) = lower(:sha)
                ORDER BY votes DESC, p.public_read_at DESC
                LIMIT 10
                """);
        nq.setParameter("sha", sha256);

        @SuppressWarnings("unchecked")
        List<Object[]> rows = nq.getResultList();
        var out = new ArrayList<DedupMatch>(rows.size());
        for (Object[] r : rows) {
            out.add(new DedupMatch(
                    (UUID) r[0],
                    (String) r[1],
                    CommunityService.displayNameOrFallback((String) r[2], (String) r[3]),
                    ((Number) r[4]).longValue()));
        }
        return out;
    }
}
