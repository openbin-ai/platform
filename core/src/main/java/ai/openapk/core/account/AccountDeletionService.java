package ai.openapk.core.account;

import ai.openapk.core.auth.User;
import ai.openapk.core.auth.UserRepository;
import ai.openapk.core.projects.ProjectService;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.transaction.support.TransactionSynchronization;
import org.springframework.transaction.support.TransactionSynchronizationManager;

import java.util.List;
import java.util.UUID;

/**
 * Self-service account deletion.
 *
 * <p>Design (decided with product): PRIVATE data is hard-deleted; PUBLIC
 * contributions are kept but anonymized. Rather than reassign published
 * projects to a separate tombstone user — which would orphan their media,
 * since S3/filesystem paths are keyed by the OWNER's id — we anonymize the
 * {@code users} row IN PLACE and keep it. The row survives, so published
 * reports, blog posts, forks-from links, and their media all keep resolving,
 * now attributed to an anonymous "Deleted researcher".
 *
 * <p>What gets destroyed:
 * <ul>
 *   <li>Every unpublished project the user owns, including its S3/disk bytes
 *       and the shared analysis blob (via {@link ProjectService#delete}, which
 *       is the only path that frees storage — a raw DB delete would orphan
 *       the bucket).</li>
 *   <li>BYOK LLM credentials (encrypted secrets), the LLM audit log, usage
 *       limits, worker runs.</li>
 *   <li>Notifications, email preferences, report templates.</li>
 *   <li>Direct-message conversations the user is in (both sides).</li>
 *   <li>The user's outgoing social footprint: follows, report/post votes,
 *       and their collaborator memberships on other people's projects.</li>
 * </ul>
 *
 * <p>What is kept (anonymized): community-published projects + their reports
 * and media, blog posts, report comments, and contributor bylines (the stored
 * name/gravatar snapshot is scrubbed to the anonymous label).
 *
 * <p>Finally the Keycloak identity is deleted (post-commit) so the account
 * can't auto-reprovision on its next request. The DB {@code keycloak_sub} is
 * also scrambled to a value no JWT can match, which closes the window even if
 * the IdP delete can't run.
 */
@Service
public class AccountDeletionService {

    private static final Logger log = LoggerFactory.getLogger(AccountDeletionService.class);

    private static final String ANON_NAME = "Deleted researcher";

    /** Leaf tables to purge by {@code user_id}. Order doesn't matter — no FKs between them. */
    private static final List<String> DELETE_BY_USER_ID = List.of(
            "llm_credentials",
            "llm_audit_log",
            "llm_user_limits",
            "worker_runs",
            "notifications",
            "user_email_preferences",
            "report_templates",
            "report_votes",
            "post_votes",
            "project_collaborators",   // the user's memberships on OTHERS' projects
            "project_presence"
    );

    private final JdbcTemplate jdbc;
    private final ProjectService projects;
    private final UserRepository users;
    private final KeycloakAdminClient keycloak;

    public AccountDeletionService(
            JdbcTemplate jdbc,
            ProjectService projects,
            UserRepository users,
            KeycloakAdminClient keycloak
    ) {
        this.jdbc = jdbc;
        this.projects = projects;
        this.users = users;
        this.keycloak = keycloak;
    }

    /**
     * Delete {@code user}'s account. Runs in one transaction so a mid-way
     * failure leaves the account fully intact (nothing half-deleted). The
     * Keycloak identity delete is registered for after-commit so we only touch
     * the IdP once the local erasure is durable.
     */
    @Transactional
    public void deleteOwnAccount(User user) {
        UUID userId = user.getId();
        String realSub = user.getKeycloakSub();
        log.info("account deletion starting for user={}", userId);

        // 1. Hard-delete every UNPUBLISHED project through ProjectService so
        //    storage (S3/disk) and the shared analysis blob are freed. Published
        //    ones are kept (they carry public community reports) and will hang
        //    off the anonymized row.
        List<UUID> unpublished = unpublishedProjectIds(userId);
        for (UUID pid : unpublished) {
            projects.delete(user, pid);
        }
        log.info("account deletion user={}: removed {} unpublished projects", userId, unpublished.size());

        // 2. Purge private leaf tables.
        for (String table : DELETE_BY_USER_ID) {
            jdbc.update("DELETE FROM " + table + " WHERE user_id = ?", userId);
        }
        // follows uses two user columns.
        jdbc.update("DELETE FROM follows WHERE follower_id = ? OR followee_id = ?", userId, userId);
        // Direct messages: delete every 1:1 conversation the user is in.
        // Members and messages cascade. The other party loses that thread too —
        // deliberate: the deleting user's words should not outlive them.
        // Project team chats belong to the project, not to any one member, so
        // only this user's membership row goes; their messages stay, attributed
        // to the anonymized users row.
        jdbc.update("DELETE FROM dm_conversations WHERE project_id IS NULL AND id IN (SELECT conversation_id FROM dm_members WHERE user_id = ?)", userId);
        jdbc.update("DELETE FROM dm_members WHERE user_id = ?", userId);

        // 3. Scrub the contributor byline snapshot (name + gravatar hash) that
        //    survives on kept public reports.
        jdbc.update(
                "UPDATE report_contributors SET display_name = ?, email_md5 = NULL WHERE user_id = ?",
                ANON_NAME, userId);

        // 4. Anonymize the users row in place. Scramble keycloak_sub so no JWT
        //    can ever match it again (belt-and-suspenders with the IdP delete),
        //    null all PII/profile, drop the public byline opt-in.
        user.setKeycloakSub("deleted:" + UUID.randomUUID());
        user.setEmail(null);
        user.setDisplayName(ANON_NAME);
        user.setBio(null);
        user.setWebsiteUrl(null);
        user.setGithubUser(null);
        user.setXUser(null);
        user.setMastodonUrl(null);
        user.setLinkedinUrl(null);
        user.setCreditPublicly(false);
        users.save(user);

        // 5. Remove the IdP identity after the local erasure commits.
        TransactionSynchronizationManager.registerSynchronization(new TransactionSynchronization() {
            @Override
            public void afterCommit() {
                keycloak.deleteUser(realSub);
            }
        });

        log.info("account deletion complete for user={} (row anonymized, {} projects kept as public)",
                userId, ownedProjectCount(userId) );
    }

    /**
     * Projects owned by the user that are NOT publicly contributed — no
     * {@code public_read_at} and no community-published report. These are the
     * ones we destroy; anything published is kept.
     */
    private List<UUID> unpublishedProjectIds(UUID userId) {
        return jdbc.queryForList("""
                SELECT p.id
                FROM projects p
                WHERE p.user_id = ?
                  AND p.public_read_at IS NULL
                  AND NOT EXISTS (
                        SELECT 1 FROM project_reports r
                        WHERE r.project_id = p.id
                          AND r.community_published_at IS NOT NULL
                  )
                """, UUID.class, userId);
    }

    private int ownedProjectCount(UUID userId) {
        Integer n = jdbc.queryForObject("SELECT COUNT(*) FROM projects WHERE user_id = ?", Integer.class, userId);
        return n == null ? 0 : n;
    }
}
