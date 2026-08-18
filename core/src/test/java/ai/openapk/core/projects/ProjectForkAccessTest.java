package ai.openapk.core.projects;

import ai.openapk.core.analysis.AnalysisMode;
import ai.openapk.core.auth.User;
import ai.openapk.core.auth.UserRepository;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.autoconfigure.ImportAutoConfiguration;
import org.springframework.boot.data.jpa.test.autoconfigure.DataJpaTest;
import org.springframework.boot.flyway.autoconfigure.FlywayAutoConfiguration;
import org.springframework.boot.jdbc.test.autoconfigure.AutoConfigureTestDatabase;
import org.springframework.context.annotation.Import;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Component;
import org.springframework.test.context.TestPropertySource;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.server.ResponseStatusException;

import java.time.Instant;
import java.util.UUID;

import static org.junit.jupiter.api.Assertions.assertDoesNotThrow;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * Access resolution for {@code POST /api/projects/{id}/fork}, and the
 * transaction-semantics trap underneath it.
 *
 * <p>Forking a PUBLIC project you don't otherwise have a role on 500'd in
 * production with {@code UnexpectedRollbackException: Transaction silently
 * rolled back because it has been marked as rollback-only}. The cause is not
 * in the fork logic at all: {@link ProjectAccessGuard#requireRead} is itself
 * {@code @Transactional}, so when it throws 404 for "not a collaborator" the
 * transaction interceptor marks the CALLER'S transaction rollback-only before
 * the exception is even visible to the caller. The caller then catches the
 * 404, falls back to the public lookup, does its work, and blows up at commit.
 *
 * <p>Every assertion here needs a real transaction manager and a real
 * database, so this runs against the local compose Postgres in a scratch
 * {@code openapk_test} database (see the class docs on how to bring it up).
 * The test methods themselves are deliberately NOT transactional — the bug
 * only exists at commit time, so a test-managed rolled-back transaction
 * would hide it.
 *
 * <p>Setup:
 * <pre>
 *   cd core && docker compose up -d postgres
 *   docker exec openapk-postgres psql -U openapk -d postgres \
 *       -c "CREATE DATABASE openapk_test OWNER openapk"
 *   JAVA_HOME=/usr/lib/jvm/java-21-openjdk-amd64 ./mvnw test -Dtest=ProjectForkAccessTest
 * </pre>
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
// @DataJpaTest doesn't pull Flyway in, and ddl-auto is `validate` — without
// this the scratch database has no schema to validate against.
@ImportAutoConfiguration(FlywayAutoConfiguration.class)
@Import({ProjectAccessGuard.class, ProjectPublicGuard.class, ProjectForkAccessTest.ForkLikeCaller.class})
@Transactional(propagation = Propagation.NOT_SUPPORTED)
class ProjectForkAccessTest {

    @Autowired ProjectAccessGuard guard;
    @Autowired ProjectPublicGuard publicGuard;
    @Autowired ForkLikeCaller caller;
    @Autowired ProjectRepository projects;
    @Autowired UserRepository users;

    private User owner;
    private User stranger;

    @BeforeEach
    void seed() {
        owner = users.save(user("owner"));
        stranger = users.save(user("stranger"));
    }

    @Test
    void ownerCanResolveTheirOwnProject() {
        Project p = projects.save(project(owner, null));
        assertTrue(guard.findReadable(owner, p.getId()).isPresent());
    }

    @Test
    void findReadableReturnsEmptyForAStrangerInsteadOfThrowing() {
        // The throwing variant is what poisons a caller's transaction. Any
        // caller that wants to FALL BACK on failure must use this one.
        Project p = projects.save(project(owner, null));
        assertTrue(guard.findReadable(stranger, p.getId()).isEmpty());
    }

    @Test
    void findPublicResolvesOnlyPubliclyReadableProjects() {
        Project priv = projects.save(project(owner, null));
        Project pub = projects.save(project(owner, Instant.now()));
        assertTrue(publicGuard.findPublic(priv.getId()).isEmpty());
        assertTrue(publicGuard.findPublic(pub.getId()).isPresent());
    }

    /**
     * Backs the "forked from" link target: a fork's owner usually has no role
     * on the source, so the UI needs to know the source is public and send
     * them to /public/projects/{id} instead of the authenticated view.
     */
    @Test
    void existsByIdAndPublicReadAtIsNotNullTracksVisibility() {
        Project priv = projects.save(project(owner, null));
        Project pub = projects.save(project(owner, Instant.now()));
        assertTrue(projects.existsByIdAndPublicReadAtIsNotNull(pub.getId()));
        org.junit.jupiter.api.Assertions.assertFalse(
                projects.existsByIdAndPublicReadAtIsNotNull(priv.getId()));
        org.junit.jupiter.api.Assertions.assertFalse(
                projects.existsByIdAndPublicReadAtIsNotNull(UUID.randomUUID()));
    }

    @Test
    void requireReadStill404sForAStranger() {
        Project p = projects.save(project(owner, null));
        ResponseStatusException e = org.junit.jupiter.api.Assertions.assertThrows(
                ResponseStatusException.class, () -> guard.requireRead(stranger, p.getId()));
        assertEquals(HttpStatus.NOT_FOUND, e.getStatusCode());
    }

    /**
     * THE REGRESSION. This is the exact shape of the fork 500: inside one
     * transaction, ask the guard for read access, swallow its 404, then
     * write. Before the fix this threw UnexpectedRollbackException at commit
     * even though nothing was actually wrong with the write.
     */
    @Test
    void aSwallowedGuard404DoesNotPoisonTheCallersTransaction() {
        Project source = projects.save(project(owner, Instant.now()));
        UUID id = assertDoesNotThrow(() -> caller.resolveThenWrite(stranger, source.getId()));
        assertTrue(projects.findById(id).isPresent(), "the write must survive the commit");
    }

    /**
     * Stand-in for {@code ProjectService.fork} — same transaction shape
     * (one @Transactional method that consults the guard and then writes)
     * without dragging in the service's storage / LLM / worker collaborators.
     */
    @Component
    static class ForkLikeCaller {
        private final ProjectAccessGuard guard;
        private final ProjectPublicGuard publicGuard;
        private final ProjectRepository projects;

        ForkLikeCaller(ProjectAccessGuard guard, ProjectPublicGuard publicGuard, ProjectRepository projects) {
            this.guard = guard;
            this.publicGuard = publicGuard;
            this.projects = projects;
        }

        @Transactional
        UUID resolveThenWrite(User caller, UUID sourceId) {
            Project source;
            try {
                source = guard.requireRead(caller, sourceId);
            } catch (ResponseStatusException e) {
                source = publicGuard.requirePublic(sourceId);
            }
            Project copy = project(caller, null);
            copy.setName(source.getName() + " (fork)");
            copy.setForkedFrom(source);
            Project saved = projects.save(copy);
            source.setForkCount(source.getForkCount() + 1);
            projects.save(source);
            return saved.getId();
        }
    }

    private static User user(String tag) {
        User u = new User();
        u.setKeycloakSub(tag + "-" + UUID.randomUUID());
        u.setEmail(tag + "@example.test");
        u.setDisplayName(tag);
        return u;
    }

    private static Project project(User owner, Instant publicReadAt) {
        Project p = new Project();
        p.setUser(owner);
        p.setKind(ProjectKind.BIN);
        p.setName("libtarget.so");
        p.setOriginalFilename("libtarget.so");
        p.setSizeBytes(1234L);
        p.setSha256("0".repeat(64));
        p.setStatus(ProjectStatus.READY);
        p.setWorkflowStatus(WorkflowStatus.NEW);
        p.setAnalysisMode(AnalysisMode.MALWARE);
        p.setBinaryAnalysisS3Key("analysis/test.json.gz");
        p.setPublicReadAt(publicReadAt);
        return p;
    }
}
