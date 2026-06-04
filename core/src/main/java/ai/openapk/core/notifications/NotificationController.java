package ai.openapk.core.notifications;

import ai.openapk.core.auth.CurrentUserService;
import ai.openapk.core.notifications.dto.EmailPrefsResponse;
import ai.openapk.core.notifications.dto.UpdateEmailPrefsRequest;
import jakarta.validation.Valid;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PatchMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/**
 * Lets the signed-in user view + toggle their transactional-email opt-outs.
 * The settings page in the frontends calls GET on mount and PATCH on every
 * toggle change; the body shape only needs to carry the flipped field
 * thanks to {@link UpdateEmailPrefsRequest}'s nullable fields.
 */
@RestController
@RequestMapping("/api/me/email-preferences")
public class NotificationController {

    private final NotificationService service;
    private final CurrentUserService currentUser;

    public NotificationController(NotificationService service, CurrentUserService currentUser) {
        this.service = service;
        this.currentUser = currentUser;
    }

    @GetMapping
    public EmailPrefsResponse get() {
        return service.currentPrefs(currentUser.current());
    }

    @PatchMapping
    public EmailPrefsResponse update(@Valid @RequestBody UpdateEmailPrefsRequest req) {
        return service.updatePrefs(currentUser.current(), req);
    }
}
