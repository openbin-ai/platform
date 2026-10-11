package ai.openapk.core.dm;

import ai.openapk.core.auth.CurrentUserService;
import ai.openapk.core.dm.dto.DmConversationSummary;
import ai.openapk.core.dm.dto.DmMessageResponse;
import ai.openapk.core.dm.dto.DmSettingsResponse;
import ai.openapk.core.dm.dto.UpdateDmSettingsRequest;
import ai.openapk.core.dm.dto.DmUnreadResponse;
import ai.openapk.core.dm.dto.SendDmRequest;
import jakarta.validation.Valid;
import org.springframework.format.annotation.DateTimeFormat;
import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;

import java.time.Instant;
import java.util.List;
import java.util.UUID;

/**
 * Direct messages. Everything under /api/dm is authenticated (SecurityConfig's
 * /api/** rule). Shared by openbin and openapk — DMs are user-level, not
 * product-level, so a conversation started on one app continues on the other.
 */
@RestController
@RequestMapping("/api/dm")
public class DmController {

    private final DmService dm;
    private final CurrentUserService currentUser;

    public DmController(DmService dm, CurrentUserService currentUser) {
        this.dm = dm;
        this.currentUser = currentUser;
    }

    /** Inbox: every conversation the caller is in, newest activity first. */
    @GetMapping("/conversations")
    public List<DmConversationSummary> inbox() {
        return dm.inbox(currentUser.current());
    }

    /** Who may DM me (EVERYONE | FOLLOWING | NOBODY). */
    @GetMapping("/settings")
    public DmSettingsResponse settings() {
        return dm.settings(currentUser.current());
    }

    @PutMapping("/settings")
    public DmSettingsResponse updateSettings(@Valid @RequestBody UpdateDmSettingsRequest req) {
        return dm.updateSettings(currentUser.current(), req.policy());
    }

    /** Badge: how many conversations have unread messages. */
    @GetMapping("/unread-count")
    public DmUnreadResponse unread() {
        return new DmUnreadResponse(dm.unreadConversations(currentUser.current()));
    }

    /** Get-or-create the 1:1 conversation with another user (the profile's Message button). */
    @PostMapping("/conversations/with/{userId}")
    public DmConversationSummary openWith(@PathVariable("userId") UUID userId) {
        return dm.openWith(currentUser.current(), userId);
    }

    /**
     * Get-or-create a project's team chat. Any roster member (owner,
     * editor, viewer) may open it; the rest of the thread API is the same
     * as for a DM.
     */
    @PostMapping("/conversations/for-project/{projectId}")
    public DmConversationSummary openForProject(@PathVariable("projectId") UUID projectId) {
        return dm.openForProject(currentUser.current(), projectId);
    }

    @GetMapping("/conversations/{id}")
    public DmConversationSummary get(@PathVariable("id") UUID id) {
        return dm.get(currentUser.current(), id);
    }

    /**
     * Thread page, oldest-first. {@code before} pages back in history;
     * {@code after} returns only newer messages (the open thread's poll).
     */
    @GetMapping("/conversations/{id}/messages")
    public List<DmMessageResponse> messages(
            @PathVariable("id") UUID id,
            @RequestParam(value = "before", required = false)
            @DateTimeFormat(iso = DateTimeFormat.ISO.DATE_TIME) Instant before,
            @RequestParam(value = "after", required = false)
            @DateTimeFormat(iso = DateTimeFormat.ISO.DATE_TIME) Instant after,
            @RequestParam(value = "size", defaultValue = "50") int size
    ) {
        if (after != null) return dm.after(currentUser.current(), id, after, size);
        return dm.page(currentUser.current(), id, before, size);
    }

    @PostMapping("/conversations/{id}/messages")
    @ResponseStatus(HttpStatus.CREATED)
    public DmMessageResponse send(@PathVariable("id") UUID id, @Valid @RequestBody SendDmRequest req) {
        return dm.send(currentUser.current(), id, req.body());
    }

    @PostMapping("/conversations/{id}/read")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    public void markRead(@PathVariable("id") UUID id) {
        dm.markRead(currentUser.current(), id);
    }
}
