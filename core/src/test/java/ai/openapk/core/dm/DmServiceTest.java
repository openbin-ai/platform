package ai.openapk.core.dm;

import ai.openapk.core.auth.User;
import ai.openapk.core.auth.UserRepository;
import ai.openapk.core.dm.dto.DmConversationSummary;
import ai.openapk.core.dm.dto.DmMessageResponse;
import ai.openapk.core.social.Follow;
import ai.openapk.core.social.FollowRepository;
import ai.openapk.core.analysis.AnalysisMode;
import ai.openapk.core.projects.Project;
import ai.openapk.core.projects.ProjectCollaborator;
import ai.openapk.core.projects.ProjectCollaboratorRepository;
import ai.openapk.core.projects.ProjectKind;
import ai.openapk.core.projects.ProjectRepository;
import ai.openapk.core.projects.ProjectRole;
import ai.openapk.core.projects.ProjectStatus;
import ai.openapk.core.projects.WorkflowStatus;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.autoconfigure.ImportAutoConfiguration;
import org.springframework.boot.data.jpa.test.autoconfigure.DataJpaTest;
import org.springframework.boot.flyway.autoconfigure.FlywayAutoConfiguration;
import org.springframework.boot.jdbc.test.autoconfigure.AutoConfigureTestDatabase;
import org.springframework.context.annotation.Import;
import org.springframework.http.HttpStatus;
import org.springframework.test.context.TestPropertySource;
import org.springframework.web.server.ResponseStatusException;

import java.time.Instant;
import java.util.List;
import java.util.UUID;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * Direct-message access + read-state rules. Same harness as
 * {@link ai.openapk.core.projects.ProjectForkAccessTest}: real Postgres
 * ({@code openapk_test}), Flyway-migrated, so the UNIQUE pair_key and the
 * unread queries run for real.
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
@Import({DmService.class, ai.openapk.core.projects.ProjectAccessGuard.class})
class DmServiceTest {

    @Autowired DmService dm;
    @Autowired UserRepository users;
    @Autowired FollowRepository follows;
    @Autowired ProjectRepository projects;
    @Autowired ProjectCollaboratorRepository collaborators;

    User alice, bob, carol;

    @BeforeEach
    void users() {
        alice = user("alice");
        bob = user("bob");
        carol = user("carol");
    }

    private User user(String name) {
        User u = new User();
        u.setKeycloakSub("test:" + name + ":" + UUID.randomUUID());
        u.setEmail(name + "+" + UUID.randomUUID() + "@example.test");
        u.setDisplayName(name);
        u.setCreatedAt(Instant.now());
        u.setLastSeenAt(Instant.now());
        return users.saveAndFlush(u);
    }

    @Test
    void openWithIsIdempotentAndSymmetric() {
        DmConversationSummary ab = dm.openWith(alice, bob.getId());
        DmConversationSummary ba = dm.openWith(bob, alice.getId());
        assertEquals(ab.id(), ba.id(), "both directions resolve to the one conversation");
        assertEquals(bob.getId(), ab.other().userId());
        assertEquals(alice.getId(), ba.other().userId());
        assertEquals("bob", ab.other().displayName());
    }

    @Test
    void cannotMessageSelfOrUnknownUser() {
        assertEquals(HttpStatus.BAD_REQUEST,
                assertThrows(ResponseStatusException.class, () -> dm.openWith(alice, alice.getId())).getStatusCode());
        assertEquals(HttpStatus.NOT_FOUND,
                assertThrows(ResponseStatusException.class, () -> dm.openWith(alice, UUID.randomUUID())).getStatusCode());
    }

    @Test
    void nonMembersGet404Everywhere() {
        UUID cid = dm.openWith(alice, bob.getId()).id();
        assertEquals(HttpStatus.NOT_FOUND,
                assertThrows(ResponseStatusException.class, () -> dm.get(carol, cid)).getStatusCode());
        assertEquals(HttpStatus.NOT_FOUND,
                assertThrows(ResponseStatusException.class, () -> dm.page(carol, cid, null, 50)).getStatusCode());
        assertEquals(HttpStatus.NOT_FOUND,
                assertThrows(ResponseStatusException.class, () -> dm.send(carol, cid, "hi")).getStatusCode());
        assertEquals(HttpStatus.NOT_FOUND,
                assertThrows(ResponseStatusException.class, () -> dm.markRead(carol, cid)).getStatusCode());
    }

    @Test
    void sendUpdatesInboxUnreadAndReadCursor() {
        UUID cid = dm.openWith(alice, bob.getId()).id();
        DmMessageResponse m1 = dm.send(alice, cid, "  hey bob  ");
        assertEquals("hey bob", m1.body(), "body is trimmed");
        assertTrue(m1.mine());

        // Bob: one unread conversation, one unread message, preview from Alice.
        assertEquals(1, dm.unreadConversations(bob));
        List<DmConversationSummary> bobInbox = dm.inbox(bob);
        assertEquals(1, bobInbox.size());
        assertEquals(1, bobInbox.get(0).unread());
        assertEquals("hey bob", bobInbox.get(0).lastMessagePreview());
        assertFalse(bobInbox.get(0).lastMessageMine());

        // Alice sent it, so nothing is unread for her.
        assertEquals(0, dm.unreadConversations(alice));
        assertTrue(dm.inbox(alice).get(0).lastMessageMine());

        // Reading clears it; a reply flips it the other way.
        dm.markRead(bob, cid);
        assertEquals(0, dm.unreadConversations(bob));
        dm.send(bob, cid, "hey alice");
        assertEquals(1, dm.unreadConversations(alice));
        assertEquals(0, dm.unreadConversations(bob));

        // Thread is oldest-first; `after` only returns the newer message.
        List<DmMessageResponse> thread = dm.page(alice, cid, null, 50);
        assertEquals(List.of("hey bob", "hey alice"), thread.stream().map(DmMessageResponse::body).toList());
        List<DmMessageResponse> newer = dm.after(alice, cid, m1.createdAt(), 50);
        assertEquals(List.of("hey alice"), newer.stream().map(DmMessageResponse::body).toList());
        assertFalse(newer.get(0).mine());
    }

    @Test
    void emptyAndOversizedMessagesAreRejected() {
        UUID cid = dm.openWith(alice, bob.getId()).id();
        assertEquals(HttpStatus.BAD_REQUEST,
                assertThrows(ResponseStatusException.class, () -> dm.send(alice, cid, "   ")).getStatusCode());
        assertEquals(HttpStatus.BAD_REQUEST,
                assertThrows(ResponseStatusException.class, () -> dm.send(alice, cid, "x".repeat(4001))).getStatusCode());
    }

    private void follow(User follower, User followee) {
        Follow f = new Follow();
        f.setId(new Follow.Id(follower.getId(), followee.getId()));
        f.setFollower(follower);
        f.setFollowee(followee);
        follows.saveAndFlush(f);
    }

    @Test
    void followingPolicyOnlyAdmitsPeopleTheRecipientFollows() {
        dm.updateSettings(bob, DmPolicy.FOLLOWING);
        bob = users.findById(bob.getId()).orElseThrow();
        assertFalse(dm.canMessage(alice, bob));
        assertEquals(HttpStatus.FORBIDDEN,
                assertThrows(ResponseStatusException.class, () -> dm.openWith(alice, bob.getId())).getStatusCode());

        follow(bob, alice); // bob follows alice → alice is on bob's allowlist
        assertTrue(dm.canMessage(alice, bob));
        UUID cid = dm.openWith(alice, bob.getId()).id();
        dm.send(alice, cid, "hi");
        // The other direction is bob's choice: alice's policy is EVERYONE.
        dm.send(bob, cid, "hey");
    }

    @Test
    void nobodyPolicyMakesExistingThreadReadOnlyForTheOtherSide() {
        UUID cid = dm.openWith(alice, bob.getId()).id();
        dm.send(alice, cid, "before");
        dm.updateSettings(bob, DmPolicy.NOBODY);
        assertEquals(HttpStatus.FORBIDDEN,
                assertThrows(ResponseStatusException.class, () -> dm.send(alice, cid, "after")).getStatusCode());
        assertEquals(HttpStatus.FORBIDDEN,
                assertThrows(ResponseStatusException.class, () -> dm.openWith(alice, bob.getId())).getStatusCode());
        // Bob can still write — the gate is the recipient's policy.
        dm.send(bob, cid, "I can still reply");
        assertEquals(DmPolicy.NOBODY, dm.settings(users.findById(bob.getId()).orElseThrow()).policy());
    }

    @Test
    void previewIsSingleLineAndCapped() {
        assertEquals("a b c", DmService.preview("a\n\n b\tc "));
        String longText = "y".repeat(500);
        String p = DmService.preview(longText);
        assertEquals(DmService.PREVIEW_CHARS, p.length());
        assertTrue(p.endsWith("…"));
    }

    // --- project team chat (V45) --------------------------------------------------

    private Project project(User owner) {
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
        return projects.saveAndFlush(p);
    }

    private void collaborate(Project p, User u, ProjectRole role) {
        ProjectCollaborator c = new ProjectCollaborator();
        c.setId(new ProjectCollaborator.Id(p.getId(), u.getId()));
        c.setProject(p);
        c.setUser(u);
        c.setRole(role);
        c.setInvitedBy(p.getUser());
        collaborators.saveAndFlush(c);
    }

    @Test
    void projectChatIsOnePerProjectAndFollowsTheRoster() {
        Project p = project(alice);
        collaborate(p, bob, ProjectRole.VIEWER);

        DmConversationSummary byOwner = dm.openForProject(alice, p.getId());
        DmConversationSummary byViewer = dm.openForProject(bob, p.getId());
        assertEquals(byOwner.id(), byViewer.id(), "owner and collaborator land in the one project chat");
        assertEquals(p.getId(), byOwner.projectId());
        assertEquals("libtarget.so", byOwner.projectName());
        assertEquals(2, byViewer.memberCount());

        // Not on the roster: 404 everywhere, same as a DM you are not in.
        assertEquals(HttpStatus.NOT_FOUND,
                assertThrows(ResponseStatusException.class, () -> dm.openForProject(carol, p.getId())).getStatusCode());
        assertEquals(HttpStatus.NOT_FOUND,
                assertThrows(ResponseStatusException.class, () -> dm.page(carol, byOwner.id(), null, 50)).getStatusCode());

        // Viewers can post, and the sender travels with the message for group labelling.
        DmMessageResponse m = dm.send(bob, byOwner.id(), "found the C2 config");
        assertEquals("bob", m.sender().displayName());
        assertEquals(1, dm.inbox(alice).get(0).unread());
        assertEquals(p.getId(), dm.inbox(alice).get(0).projectId());

        // Off the roster: the thread is gone for bob, even though his member row lingers.
        collaborators.findByProjectIdAndUserId(p.getId(), bob.getId()).ifPresent(collaborators::delete);
        collaborators.flush();
        assertEquals(HttpStatus.NOT_FOUND,
                assertThrows(ResponseStatusException.class, () -> dm.send(bob, byOwner.id(), "still here?")).getStatusCode());
        assertTrue(dm.inbox(bob).isEmpty(), "project chats of projects you lost access to drop off the inbox");
    }

    @Test
    void projectChatIgnoresTheRecipientDmPolicy() {
        Project p = project(alice);
        collaborate(p, bob, ProjectRole.EDITOR);
        // Bob blocks all DMs; the team chat is opt-in by roster, so Alice still posts.
        dm.updateSettings(bob, DmPolicy.NOBODY);
        UUID cid = dm.openForProject(alice, p.getId()).id();
        dm.openForProject(bob, p.getId());
        assertEquals("hi team", dm.send(alice, cid, "hi team").body());
        // A direct DM to bob is still refused.
        assertEquals(HttpStatus.FORBIDDEN,
                assertThrows(ResponseStatusException.class, () -> dm.openWith(alice, bob.getId())).getStatusCode());
    }
}
