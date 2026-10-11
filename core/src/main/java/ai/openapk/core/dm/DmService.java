package ai.openapk.core.dm;

import ai.openapk.core.auth.User;
import ai.openapk.core.auth.UserRepository;
import ai.openapk.core.dm.dto.DmConversationSummary;
import ai.openapk.core.dm.dto.DmMessageResponse;
import ai.openapk.core.dm.dto.DmSettingsResponse;
import ai.openapk.core.dm.dto.DmUser;
import ai.openapk.core.projects.Project;
import ai.openapk.core.projects.ProjectAccessGuard;
import ai.openapk.core.social.FollowRepository;
import ai.openapk.core.reports.CommunityService;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.data.domain.PageRequest;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.server.ResponseStatusException;

import java.time.Instant;
import java.util.ArrayDeque;
import java.util.ArrayList;
import java.util.Collections;
import java.util.Deque;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;

/**
 * Direct messages between researchers. 1:1 only for now; the tables are
 * shaped for group conversations later (CTF teams) — see V42.
 *
 * <p>Access rule is the same everywhere: you can read/write a conversation
 * iff you have a {@code dm_members} row in it. Non-members get 404, never
 * 403, so a conversation id leaks nothing about who talks to whom.
 *
 * <p>No notification rows or emails are created per message: the nav badge
 * ({@link #unreadConversations}) is the signal, polled like the bell. A
 * per-message bell entry would be noise in a live chat.
 *
 * <p>Recipients gate who may reach them via {@link DmPolicy} (users.dm_policy).
 * The gate is checked when a conversation is opened AND on every send, so
 * tightening the policy makes existing threads read-only for the other side
 * immediately — no "but we already had a thread" loophole.
 */
@Service
public class DmService {

    /** Preview stored on the conversation row for the inbox list. */
    static final int PREVIEW_CHARS = 120;
    static final int PAGE_SIZE_MAX = 100;

    /** Cheap spam brake: messages per sender per sliding minute. */
    static final int RATE_PER_MINUTE = 30;

    private final DmConversationRepository conversations;
    private final DmMemberRepository members;
    private final DmMessageRepository messages;
    private final UserRepository users;
    private final FollowRepository follows;
    private final ProjectAccessGuard projects;

    /** sender id → send timestamps within the last minute (in-memory, per node). */
    private final Map<UUID, Deque<Long>> sendLog = new ConcurrentHashMap<>();

    public DmService(DmConversationRepository conversations, DmMemberRepository members,
                     DmMessageRepository messages, UserRepository users, FollowRepository follows,
                     ProjectAccessGuard projects) {
        this.conversations = conversations;
        this.members = members;
        this.messages = messages;
        this.users = users;
        this.follows = follows;
        this.projects = projects;
    }

    // --- policy -------------------------------------------------------------

    /**
     * May {@code sender} message {@code recipient}? Decided by the RECIPIENT's
     * policy: EVERYONE → yes; FOLLOWING → only if the recipient follows the
     * sender; NOBODY → no. Self is never allowed (there's no self-DM).
     */
    @Transactional(readOnly = true)
    public boolean canMessage(User sender, User recipient) {
        if (sender == null || recipient == null) return false;
        if (sender.getId().equals(recipient.getId())) return false;
        return switch (DmPolicy.of(recipient.getDmPolicy())) {
            case EVERYONE -> true;
            case FOLLOWING -> follows.existsByFollowerIdAndFolloweeId(recipient.getId(), sender.getId());
            case NOBODY -> false;
        };
    }

    @Transactional(readOnly = true)
    public DmSettingsResponse settings(User me) {
        return new DmSettingsResponse(DmPolicy.of(me.getDmPolicy()));
    }

    @Transactional
    public DmSettingsResponse updateSettings(User me, DmPolicy policy) {
        User u = users.findById(me.getId()).orElseThrow(() ->
                new ResponseStatusException(HttpStatus.NOT_FOUND, "user not found"));
        u.setDmPolicy(policy.name());
        users.save(u);
        return new DmSettingsResponse(policy);
    }

    private void requireCanMessage(User sender, User recipient) {
        if (!canMessage(sender, recipient)) {
            String why = switch (DmPolicy.of(recipient.getDmPolicy())) {
                case FOLLOWING -> "this researcher only accepts messages from people they follow";
                case NOBODY -> "this researcher has turned off direct messages";
                default -> "you can't message this researcher";
            };
            throw new ResponseStatusException(HttpStatus.FORBIDDEN, why);
        }
    }

    // --- inbox --------------------------------------------------------------

    @Transactional(readOnly = true)
    public List<DmConversationSummary> inbox(User me) {
        List<DmConversationSummary> out = new ArrayList<>();
        for (DmMember mine : members.inbox(me.getId())) {
            DmConversation c = mine.getConversation();
            if (c.isProjectChat()) {
                // Removed from the roster = the chat disappears from the inbox,
                // even though the member row (read cursor) may linger.
                Project p = projects.findReadable(me, c.getProjectId()).orElse(null);
                if (p == null) continue;
                out.add(projectSummary(c, p, me, mine));
                continue;
            }
            User other = otherMember(c.getId(), me.getId());
            long unread = messages.countUnread(c.getId(), me.getId(), mine.getLastReadAt());
            out.add(new DmConversationSummary(
                    c.getId(),
                    toDmUser(other),
                    null, null, 0,
                    c.getLastMessageAt(),
                    c.getLastMessagePreview(),
                    me.getId().equals(c.getLastSenderId()),
                    unread));
        }
        return out;
    }

    @Transactional(readOnly = true)
    public long unreadConversations(User me) {
        return messages.countConversationsWithUnread(me.getId());
    }

    // --- open / create --------------------------------------------------------

    /**
     * Get-or-create the 1:1 conversation between the caller and {@code otherId}.
     * Race-safe: two simultaneous first messages both hit the UNIQUE pair_key;
     * the loser re-reads the winner's row.
     */
    @Transactional
    public DmConversationSummary openWith(User me, UUID otherId) {
        if (me.getId().equals(otherId)) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "cannot message yourself");
        }
        User other = users.findById(otherId).orElseThrow(() ->
                new ResponseStatusException(HttpStatus.NOT_FOUND, "user not found"));
        if (other.getKeycloakSub() != null && other.getKeycloakSub().startsWith("deleted:")) {
            throw new ResponseStatusException(HttpStatus.NOT_FOUND, "user not found");
        }
        requireCanMessage(me, other);
        String key = DmConversation.pairKeyFor(me.getId(), otherId);
        DmConversation c = conversations.findByPairKey(key).orElseGet(() -> create(key, me, other));
        return summaryFor(c, me, other);
    }

    private DmConversation create(String key, User a, User b) {
        try {
            DmConversation c = new DmConversation();
            c.setPairKey(key);
            c = conversations.saveAndFlush(c);
            members.save(DmMember.of(c, a));
            members.save(DmMember.of(c, b));
            members.flush();
            return c;
        } catch (DataIntegrityViolationException race) {
            return conversations.findByPairKey(key).orElseThrow(() -> race);
        }
    }

    /**
     * Get-or-create the project's team chat for a roster member. Any member
     * (viewers included) can read and post: joining the project is the
     * opt-in, so the recipient-side {@link DmPolicy} does not apply here.
     * The caller's member row is created on first open; it only holds their
     * read cursor. Race-safe through the partial unique index on project_id.
     */
    @Transactional
    public DmConversationSummary openForProject(User me, UUID projectId) {
        Project p = projects.requireRead(me, projectId);
        DmConversation c = conversations.findByProjectId(projectId).orElseGet(() -> {
            try {
                DmConversation fresh = new DmConversation();
                fresh.setProjectId(projectId);
                return conversations.saveAndFlush(fresh);
            } catch (DataIntegrityViolationException race) {
                return conversations.findByProjectId(projectId).orElseThrow(() -> race);
            }
        });
        DmMember mine = ensureMember(c, me);
        return projectSummary(c, p, me, mine);
    }

    @Transactional(readOnly = true)
    public DmConversationSummary get(User me, UUID conversationId) {
        DmMember mine = requireMember(conversationId, me);
        DmConversation c = mine.getConversation();
        if (c.isProjectChat()) {
            return projectSummary(c, projects.requireRead(me, c.getProjectId()), me, mine);
        }
        return summaryFor(c, me, otherMember(conversationId, me.getId()));
    }

    // --- thread -------------------------------------------------------------------

    /** Oldest-first page of messages older than {@code before} (null = newest page). */
    @Transactional(readOnly = true)
    public List<DmMessageResponse> page(User me, UUID conversationId, Instant before, int size) {
        requireMember(conversationId, me);
        int n = Math.max(1, Math.min(size, PAGE_SIZE_MAX));
        List<DmMessage> desc = messages.pageBefore(conversationId, before, PageRequest.of(0, n));
        List<DmMessageResponse> out = new ArrayList<>(desc.size());
        for (DmMessage m : desc) out.add(toResponse(m, me));
        Collections.reverse(out);
        return out;
    }

    /** Messages newer than {@code after}, oldest-first — the open thread's poll. */
    @Transactional(readOnly = true)
    public List<DmMessageResponse> after(User me, UUID conversationId, Instant after, int size) {
        requireMember(conversationId, me);
        int n = Math.max(1, Math.min(size, PAGE_SIZE_MAX));
        List<DmMessageResponse> out = new ArrayList<>();
        for (DmMessage m : messages.after(conversationId, after, PageRequest.of(0, n))) out.add(toResponse(m, me));
        return out;
    }

    @Transactional
    public DmMessageResponse send(User me, UUID conversationId, String body) {
        DmMember mine = requireMember(conversationId, me);
        String text = body == null ? "" : body.strip();
        if (text.isEmpty()) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "message is empty");
        }
        if (text.length() > 4000) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "message is too long (4000 chars max)");
        }
        if (!mine.getConversation().isProjectChat()) {
            User recipient = otherMember(conversationId, me.getId());
            if (recipient != null) requireCanMessage(me, recipient);
        }
        rateLimit(me.getId());

        DmConversation c = mine.getConversation();
        DmMessage m = new DmMessage();
        m.setConversation(c);
        m.setSender(me);
        m.setBody(text);
        m = messages.save(m);

        c.setLastMessageAt(m.getCreatedAt());
        c.setLastMessagePreview(preview(text));
        c.setLastSenderId(me.getId());
        // Sending implies having read everything before it.
        mine.setLastReadAt(m.getCreatedAt());
        return toResponse(m, me);
    }

    @Transactional
    public void markRead(User me, UUID conversationId) {
        DmMember mine = requireMember(conversationId, me);
        mine.setLastReadAt(Instant.now());
    }

    // --- helpers --------------------------------------------------------------------

    /**
     * Membership check. 1:1: a dm_members row is the whole rule. Project chat:
     * the project roster is the rule (checked live, so a removed collaborator
     * loses the thread immediately) and the member row is created on demand.
     * Non-members get 404 either way.
     */
    private DmMember requireMember(UUID conversationId, User me) {
        DmMember mine = members.findByConversation_IdAndUser_Id(conversationId, me.getId()).orElse(null);
        DmConversation c = mine != null ? mine.getConversation() : conversations.findById(conversationId).orElse(null);
        if (c == null) throw notFound();
        if (c.isProjectChat()) {
            if (projects.findReadable(me, c.getProjectId()).isEmpty()) throw notFound();
            return mine != null ? mine : ensureMember(c, me);
        }
        if (mine == null) throw notFound();
        return mine;
    }

    private static ResponseStatusException notFound() {
        return new ResponseStatusException(HttpStatus.NOT_FOUND, "conversation not found");
    }

    private DmMember ensureMember(DmConversation c, User me) {
        return members.findByConversation_IdAndUser_Id(c.getId(), me.getId())
                .orElseGet(() -> members.saveAndFlush(DmMember.of(c, me)));
    }

    private DmConversationSummary projectSummary(DmConversation c, Project p, User me, DmMember mine) {
        long unread = messages.countUnread(c.getId(), me.getId(), mine == null ? null : mine.getLastReadAt());
        int memberCount = (int) members.countByConversation_Id(c.getId());
        return new DmConversationSummary(c.getId(), null, p.getId(), p.getName(), memberCount,
                c.getLastMessageAt(), c.getLastMessagePreview(), me.getId().equals(c.getLastSenderId()), unread);
    }

    private User otherMember(UUID conversationId, UUID meId) {
        for (DmMember m : members.findMembers(conversationId)) {
            if (!m.getUser().getId().equals(meId)) return m.getUser();
        }
        return null; // group conversations (future) or a half-deleted pair
    }

    private DmConversationSummary summaryFor(DmConversation c, User me, User other) {
        DmMember mine = members.findByConversation_IdAndUser_Id(c.getId(), me.getId()).orElse(null);
        long unread = messages.countUnread(c.getId(), me.getId(), mine == null ? null : mine.getLastReadAt());
        return new DmConversationSummary(c.getId(), toDmUser(other), null, null, 0, c.getLastMessageAt(),
                c.getLastMessagePreview(), me.getId().equals(c.getLastSenderId()), unread);
    }

    private static DmMessageResponse toResponse(DmMessage m, User me) {
        return new DmMessageResponse(m.getId(), m.getSender().getId(), toDmUser(m.getSender()), m.getBody(),
                m.getCreatedAt(), m.getSender().getId().equals(me.getId()));
    }

    static DmUser toDmUser(User u) {
        if (u == null) return new DmUser(null, "Deleted researcher", CommunityService.md5Hex(null));
        return new DmUser(u.getId(), displayNameFor(u), CommunityService.md5Hex(u.getEmail()));
    }

    static String displayNameFor(User u) {
        if (u.getDisplayName() != null && !u.getDisplayName().isBlank()) return u.getDisplayName();
        String e = u.getEmail();
        if (e != null && e.contains("@")) return e.substring(0, e.indexOf('@'));
        return "Researcher";
    }

    static String preview(String text) {
        String oneLine = text.replaceAll("\\s+", " ").strip();
        return oneLine.length() <= PREVIEW_CHARS ? oneLine : oneLine.substring(0, PREVIEW_CHARS - 1) + "…";
    }

    /** Sliding-window per-sender limit; 429 when exceeded. In-memory, so per node — fine as a brake. */
    private void rateLimit(UUID senderId) {
        long now = System.currentTimeMillis();
        Deque<Long> log = sendLog.computeIfAbsent(senderId, k -> new ArrayDeque<>());
        synchronized (log) {
            while (!log.isEmpty() && now - log.peekFirst() > 60_000) log.pollFirst();
            if (log.size() >= RATE_PER_MINUTE) {
                throw new ResponseStatusException(HttpStatus.TOO_MANY_REQUESTS, "slow down — too many messages per minute");
            }
            log.addLast(now);
        }
    }
}
