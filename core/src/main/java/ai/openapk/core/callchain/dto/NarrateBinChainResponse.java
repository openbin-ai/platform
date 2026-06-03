package ai.openapk.core.callchain.dto;

import java.util.List;

/**
 * BIN narrate result. {@code summaries} carries name → narration pairs the
 * frontend can splice into its in-memory chain tree. Token + model fields
 * mirror the digest/ask/analyze responses for cost-transparency parity.
 */
public record NarrateBinChainResponse(
        List<BinNarration> summaries,
        int inputTokens,
        int outputTokens,
        String model
) {}
