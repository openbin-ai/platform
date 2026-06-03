package ai.openapk.core.callchain.dto;

import jakarta.validation.constraints.NotEmpty;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;

import java.util.List;
import java.util.UUID;

/**
 * BIN-only narrate request. Function names are sent flat (no chain
 * structure) — the openbin chain is built client-side from the analysis
 * JSON's xrefs, so all the server needs is the set of function names to
 * pull bodies for. Size capped so a deep+wide chain can't blow out the
 * prompt budget.
 */
public record NarrateBinChainRequest(
        @NotEmpty @Size(max = 50) List<String> functionNames,
        @NotNull UUID credentialId,
        String model
) {}
