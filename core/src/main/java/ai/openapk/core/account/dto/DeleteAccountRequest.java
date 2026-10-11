package ai.openapk.core.account.dto;

import jakarta.validation.constraints.NotBlank;

/**
 * Confirmation payload for {@code DELETE /api/account}. The client must echo
 * either the literal word {@code DELETE} or the account's own email address —
 * a deliberate friction step for an irreversible action.
 */
public record DeleteAccountRequest(
        @NotBlank(message = "confirmation is required") String confirm
) {}
