package ai.openapk.core.crypto.dto;

import java.util.List;

public record GenerateDecryptorResponse(
        String script,
        String explanation,
        /** Bare class name harvested from the source file (e.g. "c" for defpackage/c.java). */
        String className,
        /** Entry method names the AI identified — what callers invoke to decode. */
        List<String> entryMethods,
        /** Unique base64-ish string literals passed to those entry methods elsewhere in the project. */
        List<String> ciphertexts,
        /** Optional CyberChef recipe equivalent. Null when the algorithm doesn't map cleanly to stock ops. */
        List<CyberChefOp> cyberchefRecipe,
        String model,
        int inputTokens,
        int outputTokens
) {}
