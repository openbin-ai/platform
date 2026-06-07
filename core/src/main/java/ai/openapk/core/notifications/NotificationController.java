package ai.openapk.core.notifications;

import ai.openapk.core.auth.CurrentUserService;
import ai.openapk.core.notifications.dto.EmailPrefsResponse;
import ai.openapk.core.notifications.dto.NotificationResponse;
import ai.openapk.core.notifications.dto.UnreadCountResponse;
import ai.openapk.core.notifications.dto.UpdateEmailPrefsRequest;
import jakarta.validation.Valid;
import org.springframework.data.domain.PageRequest;
import org.springframework.http.HttpStatus;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PatchMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.server.ResponseStatusException;
import tools.jackson.core.type.TypeReference;
import tools.jackson.databind.ObjectMapper;

import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.UUID;

/**
 * Email-preferences settings + the in-app notifications bell. Kept on
 * one controller because both surfaces are scoped to the current user
 * and live in the {@code notifications} package; splitting them would
 * just mean two beans with identical wiring.
 */
@RestController
public class NotificationController {

    private final NotificationService service;
    private final CurrentUserService currentUser;
    private final NotificationRepository notifRepo;
    private final ObjectMapper mapper;

    public NotificationController(NotificationService service, CurrentUserService currentUser,
                                  NotificationRepository notifRepo, ObjectMapper mapper) {
        this.service = service;
        this.currentUser = currentUser;
        this.notifRepo = notifRepo;
        this.mapper = mapper;
    }

    // ─── email preferences ────────────────────────────────────────────

    @GetMapping("/api/me/email-preferences")
    public EmailPrefsResponse getPrefs() {
        return service.currentPrefs(currentUser.current());
    }

    @PatchMapping("/api/me/email-preferences")
    public EmailPrefsResponse updatePrefs(@Valid @RequestBody UpdateEmailPrefsRequest req) {
        return service.updatePrefs(currentUser.current(), req);
    }

    // ─── in-app notifications ─────────────────────────────────────────

    /**
     * Bell-dropdown body. Newest first; capped at {@code size} (default 20,
     * hard-capped 50). The {@code payload} field is shape-discriminated by
     * {@code kind} — the frontend renders each kind with its own template.
     */
    @GetMapping("/api/notifications")
    @Transactional(readOnly = true)
    public List<NotificationResponse> list(
            @RequestParam(value = "size", defaultValue = "20") int size
    ) {
        UUID userId = currentUser.current().getId();
        int limit = Math.min(Math.max(1, size), 50);
        return notifRepo.findByUser_IdOrderByCreatedAtDesc(userId, PageRequest.of(0, limit))
                .stream().map(this::toResponse).toList();
    }

    /** Bell badge value. Polled by the bell component every ~30s. */
    @GetMapping("/api/notifications/unread-count")
    @Transactional(readOnly = true)
    public UnreadCountResponse unreadCount() {
        return new UnreadCountResponse(
                notifRepo.countByUser_IdAndReadAtIsNull(currentUser.current().getId()));
    }

    /**
     * Mark a single notification read. 404 (without leaking existence)
     * if the row doesn't belong to the caller — same side-channel rule
     * as the rest of the system.
     */
    @PostMapping("/api/notifications/{id}/read")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    @Transactional
    public void markRead(@PathVariable("id") UUID id) {
        UUID userId = currentUser.current().getId();
        Notification n = notifRepo.findByIdAndUser_Id(id, userId).orElseThrow(() ->
                new ResponseStatusException(HttpStatus.NOT_FOUND, "notification not found"));
        if (n.getReadAt() == null) {
            n.setReadAt(Instant.now());
            notifRepo.save(n);
        }
    }

    /** Bulk mark-all-read. One UPDATE; returns the new unread count (0). */
    @PostMapping("/api/notifications/read-all")
    @Transactional
    public UnreadCountResponse markAllRead() {
        UUID userId = currentUser.current().getId();
        notifRepo.markAllRead(userId, Instant.now());
        return new UnreadCountResponse(0);
    }

    // ─── helpers ──────────────────────────────────────────────────────

    private NotificationResponse toResponse(Notification n) {
        Map<String, Object> payload;
        try {
            payload = mapper.readValue(n.getPayload(),
                    new TypeReference<Map<String, Object>>() {});
        } catch (Exception e) {
            // Corrupt payload shouldn't break the whole list — surface an
            // empty object so the frontend can still render a fallback row.
            payload = Map.of();
        }
        return new NotificationResponse(
                n.getId(), n.getKind(), payload, n.getLink(),
                n.getReadAt() != null, n.getCreatedAt()
        );
    }
}
