package ai.openapk.core.ctf;

import ai.openapk.core.auth.User;
import ai.openapk.core.auth.UserRepository;
import ai.openapk.core.config.OpenApkProperties;
import ai.openapk.core.ctf.dto.CtfDtos.AdminUpsertRequest;
import ai.openapk.core.ctf.dto.CtfDtos.SubmitResult;
import ai.openapk.core.analysis.AnalysisMode;
import ai.openapk.core.projects.Project;
import ai.openapk.core.projects.ProjectKind;
import ai.openapk.core.projects.ProjectRepository;
import ai.openapk.core.projects.ProjectService;
import ai.openapk.core.projects.ProjectStatus;
import ai.openapk.core.projects.WorkflowStatus;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.autoconfigure.ImportAutoConfiguration;
import org.springframework.boot.flyway.autoconfigure.FlywayAutoConfiguration;
import org.springframework.boot.jdbc.test.autoconfigure.AutoConfigureTestDatabase;
import org.springframework.boot.data.jpa.test.autoconfigure.DataJpaTest;
import org.springframework.context.annotation.Import;
import org.springframework.test.context.TestPropertySource;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.web.server.ResponseStatusException;

import java.time.Duration;
import java.time.Instant;
import java.util.UUID;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyBoolean;
import static org.mockito.Mockito.when;

/**
 * Scoring and rate-limit rules against real Postgres (same harness as
 * DmServiceTest). ProjectService and Discord are mocked: the service only
 * uses them to flip the challenge project public and to announce.
 */
@DataJpaTest
@AutoConfigureTestDatabase(replace = AutoConfigureTestDatabase.Replace.NONE)
@TestPropertySource(properties = {
        "spring.datasource.url=${OPENAPK_TEST_DB_URL:jdbc:postgresql://localhost:5432/openapk_test}",
        "spring.datasource.username=openapk",
        "spring.datasource.password=openapk",
        "spring.jpa.hibernate.ddl-auto=none",
        "spring.flyway.enabled=true",
})
@ImportAutoConfiguration(FlywayAutoConfiguration.class)
@Import(CtfService.class)
class CtfServiceTest {

    @Autowired CtfService ctf;
    @Autowired UserRepository users;
    @Autowired ProjectRepository projects;
    @Autowired CtfChallengeRepository challenges;
    @MockitoBean ProjectService projectService;
    @MockitoBean DiscordNotifier discord;
    @MockitoBean OpenApkProperties props;

    User admin, alice, bob, carol;
    Project bin;

    @BeforeEach
    void setUp() {
        admin = user("admin");
        alice = user("alice");
        bob = user("bob");
        carol = user("carol");
        bin = new Project();
        bin.setUser(admin);
        bin.setKind(ProjectKind.BIN);
        bin.setName("crackme");
        bin.setOriginalFilename("crackme");
        bin.setSizeBytes(1L);
        bin.setSha256("ab".repeat(32));
        bin.setStatus(ProjectStatus.READY);
        bin.setWorkflowStatus(WorkflowStatus.NEW);
        bin.setAnalysisMode(AnalysisMode.MALWARE);
        bin = projects.saveAndFlush(bin);
        when(projectService.setPublic(any(), any(), anyBoolean())).thenReturn(null);
        when(props.web()).thenReturn(new OpenApkProperties.Web("https://app.test", "https://apk.test", "", "", false));
    }

    private User user(String name) {
        User u = new User();
        u.setKeycloakSub("test:" + name + ":" + UUID.randomUUID());
        u.setEmail(name + "-" + UUID.randomUUID() + "@example.test");
        u.setDisplayName(name);
        return users.saveAndFlush(u);
    }

    private String live(String slug) {
        Instant now = Instant.now();
        ctf.adminCreate(admin, new AdminUpsertRequest(bin.getId(), slug, "Week " + slug, "desc",
                "openbin{c00ked}", "openbin{...}", now.minus(Duration.ofHours(1)), now.plus(Duration.ofDays(6))));
        return slug;
    }

    @Test
    void ranksArrivalOrderAndScoresFirstBloodHighest() {
        String slug = live("w1-" + UUID.randomUUID().toString().substring(0, 8));
        SubmitResult a = ctf.submit(alice, slug, "openbin{c00ked}", false);
        SubmitResult b = ctf.submit(bob, slug, "  openbin{c00ked}\n", true);   // whitespace tolerated
        SubmitResult c = ctf.submit(carol, slug, "openbin{c00ked}", false);
        assertTrue(a.firstBlood()); assertEquals(1, a.rank()); assertEquals(100, a.points());
        assertFalse(b.firstBlood()); assertEquals(2, b.rank()); assertEquals(90, b.points());
        assertEquals(3, c.rank()); assertEquals(80, c.points());

        var detail = ctf.get(slug, bob);
        assertEquals(3, detail.solveCount());
        assertEquals(alice.getId(), detail.solves().get(0).userId());
        assertTrue(detail.solves().get(1).aiAssisted());
        assertEquals(2, detail.mine().rank());

        var week = ctf.leaderboard("week", null);
        assertEquals(3, week.rows().size());
        assertEquals(alice.getId(), week.rows().get(0).userId());
        var season = ctf.leaderboard("season", null);
        assertEquals(alice.getId(), season.rows().get(0).userId());
        assertEquals(100, season.rows().get(0).points());
        assertEquals(1, season.rows().get(0).firstBloods());

        var home = ctf.home(null);
        assertNotNull(home.researcherOfTheWeek());
        assertEquals(alice.getId(), home.researcherOfTheWeek().solver().userId());
        assertEquals(100, ctf.statsFor(alice.getId()).points());
    }

    @Test
    void wrongFlagRecordsAttemptAndSecondSolveIsRejected() {
        String slug = live("w2-" + UUID.randomUUID().toString().substring(0, 8));
        assertFalse(ctf.submit(alice, slug, "openbin{nope}", false).correct());
        assertNull(ctf.get(slug, alice).mine());
        assertEquals(1, ctf.get(slug, null).attemptCount());
        assertTrue(ctf.submit(alice, slug, "openbin{c00ked}", false).correct());
        var e = assertThrows(ResponseStatusException.class, () -> ctf.submit(alice, slug, "openbin{c00ked}", false));
        assertEquals(409, e.getStatusCode().value());
    }

    @Test
    void attemptsAreRateLimitedPerUser() {
        String slug = live("w3-" + UUID.randomUUID().toString().substring(0, 8));
        for (int i = 0; i < CtfService.ATTEMPTS_PER_WINDOW; i++) {
            assertFalse(ctf.submit(alice, slug, "wrong" + i, false).correct());
        }
        var e = assertThrows(ResponseStatusException.class, () -> ctf.submit(alice, slug, "openbin{c00ked}", false));
        assertEquals(429, e.getStatusCode().value());
        // Another user is unaffected.
        assertTrue(ctf.submit(bob, slug, "openbin{c00ked}", false).correct());
    }

    @Test
    void solvesAfterTheWindowAreArchivePointsAndUnstartedChallengesAreInvisible() {
        Instant now = Instant.now();
        String closed = "closed-" + UUID.randomUUID().toString().substring(0, 8);
        ctf.adminCreate(admin, new AdminUpsertRequest(bin.getId(), closed, "Closed", "", "flag{x}", null,
                now.minus(Duration.ofDays(14)), now.minus(Duration.ofDays(7))));
        SubmitResult r = ctf.submit(alice, closed, "flag{x}", false);
        assertTrue(r.correct()); assertEquals(0, r.rank()); assertEquals(20, r.points()); assertFalse(r.firstBlood());
        assertNull(ctf.home(null).researcherOfTheWeek() == null ? null
                : ctf.home(null).researcherOfTheWeek().challengeSlug().equals(closed) ? "x" : null);

        String future = "future-" + UUID.randomUUID().toString().substring(0, 8);
        ctf.adminCreate(admin, new AdminUpsertRequest(bin.getId(), future, "Future", "", "flag{y}", null,
                now.plus(Duration.ofDays(1)), now.plus(Duration.ofDays(8))));
        var e = assertThrows(ResponseStatusException.class, () -> ctf.get(future, null));
        assertEquals(404, e.getStatusCode().value());
        assertEquals(future, ctf.home(null).upcoming().slug());
        assertEquals("2026-Q4".length(), challenges.findBySlug(future).orElseThrow().getSeason().length());
    }

    @Test
    void pointsTableAndSeason() {
        assertEquals(100, CtfService.pointsForRank(1));
        assertEquals(60, CtfService.pointsForRank(5));
        assertEquals(50, CtfService.pointsForRank(6));
        assertEquals(50, CtfService.pointsForRank(40));
        assertEquals(20, CtfService.pointsForRank(0));
        assertEquals("2026-Q4", CtfService.seasonOf(Instant.parse("2026-10-11T00:00:00Z")));
        assertEquals("2027-Q1", CtfService.seasonOf(Instant.parse("2027-01-01T00:00:00Z")));
    }
}
