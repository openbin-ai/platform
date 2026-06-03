package ai.openapk.core.crypto.dto;

/**
 * BIN-only decryptor result. Simpler than the APK GenerateDecryptorResponse:
 * no class / entryMethods / ciphertexts (we don't grep the project for
 * call sites — BIN has no file tree to grep over), no CyberChef recipe
 * (one shape at a time keeps the LLM honest). {@code algorithm} is a
 * short human-readable label (e.g. "XOR with rolling key", "AES-128-CBC",
 * "byte-permuted XOR table"). Token / model fields mirror the rest of the
 * AI responses for cost-transparency parity.
 */
public record GenerateBinDecryptorResponse(
        String script,
        String explanation,
        String algorithm,
        int inputTokens,
        int outputTokens,
        String model
) {}
