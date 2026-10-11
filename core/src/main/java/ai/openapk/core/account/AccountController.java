package ai.openapk.core.account;

import ai.openapk.core.account.dto.DeleteAccountRequest;
import ai.openapk.core.auth.CurrentUserService;
import ai.openapk.core.auth.User;
import jakarta.validation.Valid;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.server.ResponseStatusException;

/**
 * Self-service account management. Today just deletion — the "Danger zone"
 * in Settings → Profile posts here.
 */
@RestController
@RequestMapping("/api/account")
public class AccountController {

    private final CurrentUserService currentUser;
    private final AccountDeletionService deletion;

    public AccountController(CurrentUserService currentUser, AccountDeletionService deletion) {
        this.currentUser = currentUser;
        this.deletion = deletion;
    }

    /**
     * Permanently delete the caller's account. Irreversible. Requires a
     * confirmation string (the literal {@code DELETE} or the account email) so
     * a stray request can't wipe an account. Returns 204 on success; the
     * client should then sign the user out of the IdP.
     */
    @DeleteMapping
    @Transactional
    public ResponseEntity<Void> deleteAccount(@Valid @RequestBody DeleteAccountRequest req) {
        User user = currentUser.current();

        String confirm = req.confirm() == null ? "" : req.confirm().trim();
        String email = user.getEmail() == null ? "" : user.getEmail().trim();
        boolean ok = confirm.equalsIgnoreCase("DELETE")
                || (!email.isBlank() && confirm.equalsIgnoreCase(email));
        if (!ok) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST,
                    "Confirmation does not match. Type DELETE (or your account email) to confirm.");
        }

        deletion.deleteOwnAccount(user);
        return ResponseEntity.noContent().build();
    }
}
