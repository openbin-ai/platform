package ai.openapk.core.blog;

import ai.openapk.core.auth.User;
import ai.openapk.core.auth.UserRepository;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.autoconfigure.ImportAutoConfiguration;
import org.springframework.boot.data.jpa.test.autoconfigure.DataJpaTest;
import org.springframework.boot.flyway.autoconfigure.FlywayAutoConfiguration;
import org.springframework.boot.jdbc.test.autoconfigure.AutoConfigureTestDatabase;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.TestPropertySource;

import java.util.UUID;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * V40's schema decisions, checked against the real database.
 *
 * <p>The one that matters is the comment target: {@code report_comments} now
 * hangs off EITHER a report or a post, and "exactly one" is enforced by a
 * CHECK rather than by hoping every code path sets the right field. A
 * constraint that doesn't actually fire is worse than none, because the
 * service stops guarding what it assumes the database is guarding.
 *
 * <p>Setup is the same scratch database as ProjectForkAccessTest.
 */
@DataJpaTest
@AutoConfigureTestDatabase(replace = AutoConfigureTestDatabase.Replace.NONE)
@TestPropertySource(properties = {
        "spring.datasource.url=jdbc:postgresql://localhost:5432/openapk_test",
        "spring.datasource.username=openapk",
        "spring.datasource.password=openapk",
        "spring.docker.compose.enabled=false",
        "spring.flyway.enabled=true",
})
@ImportAutoConfiguration(FlywayAutoConfiguration.class)
class BlogSchemaTest {

    @Autowired JdbcTemplate jdbc;
    @Autowired UserRepository users;
    @Autowired BlogPostRepository posts;

    private UUID authorId;
    private UUID postId;

    @BeforeEach
    void seed() {
        User u = new User();
        u.setKeycloakSub("blog-" + UUID.randomUUID());
        u.setEmail("writer@example.test");
        u.setDisplayName("writer");
        // saveAndFlush: the raw JDBC inserts below share this transaction, and
        // JPA's write-behind would otherwise leave the FK target unwritten.
        authorId = users.saveAndFlush(u).getId();

        BlogPost p = new BlogPost();
        p.setAuthor(u);
        p.setTitle("Post");
        p.setSlug("post-" + UUID.randomUUID());
        p.setBodyMd("body");
        postId = posts.saveAndFlush(p).getId();
    }

    @Test
    void aCommentMayHangOffAPost() {
        assertEquals(1, insertComment(null, postId));
    }

    @Test
    void aCommentWithBothTargetsIsRejected() {
        UUID reportId = insertReport();
        assertThrows(Exception.class, () -> insertComment(reportId, postId),
                "a comment must not be able to belong to a report AND a post");
    }

    @Test
    void aCommentOnAReportStillWorks() {
        // The pre-existing path, re-asserted: making report_id nullable must
        // not have loosened anything for reports.
        assertEquals(1, insertComment(insertReport(), null));
    }

    @Test
    void aCommentWithNoTargetIsRejected() {
        assertThrows(Exception.class, () -> insertComment(null, null));
    }

    @Test
    void deletingAPostTakesItsCommentsAndVotesWithIt() {
        insertComment(null, postId);
        jdbc.update("INSERT INTO post_votes (user_id, post_id) VALUES (?, ?)", authorId, postId);

        posts.deleteById(postId);
        posts.flush();

        assertEquals(0, count("SELECT COUNT(*) FROM report_comments WHERE post_id = ?", postId));
        assertEquals(0, count("SELECT COUNT(*) FROM post_votes WHERE post_id = ?", postId));
    }

    @Test
    void slugIsUnique() {
        BlogPost first = posts.findById(postId).orElseThrow();
        BlogPost clash = new BlogPost();
        clash.setAuthor(first.getAuthor());
        clash.setTitle("Other");
        clash.setSlug(first.getSlug());
        clash.setBodyMd("body");
        assertThrows(Exception.class, () -> {
            posts.save(clash);
            posts.flush();
        });
    }

    @Test
    void draftsAreExcludedFromTheFeedQuery() {
        // The seeded post has no publishedAt, so it must not surface.
        var feed = posts.findAllByPublishedAtIsNotNullOrderByPublishedAtDesc(
                org.springframework.data.domain.PageRequest.of(0, 30));
        assertTrue(feed.stream().noneMatch(p -> p.getId().equals(postId)));
    }

    private int insertComment(UUID reportId, UUID postId) {
        return jdbc.update(
                "INSERT INTO report_comments (id, report_id, post_id, user_id, body, created_at) "
                        + "VALUES (?, ?, ?, ?, 'hi', now())",
                UUID.randomUUID(), reportId, postId, authorId);
    }

    /** Minimal project + report, so the both-targets case has a real FK to pair. */
    private UUID insertReport() {
        UUID projectId = UUID.randomUUID();
        jdbc.update("INSERT INTO projects (id, user_id, kind, original_filename, name, size_bytes, "
                + "sha256, status, workflow_status, analysis_mode, created_at) "
                + "VALUES (?, ?, 'BIN', 'lib.so', 'lib.so', 1, repeat('0', 64), 'READY', 'NEW', 'MALWARE', now())",
                projectId, authorId);
        UUID reportId = UUID.randomUUID();
        jdbc.update("INSERT INTO project_reports (id, project_id, title, sections_jsonb, created_at, updated_at) "
                + "VALUES (?, ?, 'r', '{\"sections\":[]}'::jsonb, now(), now())",
                reportId, projectId);
        return reportId;
    }

    private int count(String sql, Object... args) {
        Integer n = jdbc.queryForObject(sql, Integer.class, args);
        return n == null ? 0 : n;
    }
}
