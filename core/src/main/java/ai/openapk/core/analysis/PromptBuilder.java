package ai.openapk.core.analysis;

import ai.openapk.core.analysis.dto.AskFunctionRequest.PriorTurn;
import ai.openapk.core.analysis.dto.BinaryDigest;
import ai.openapk.core.analysis.dto.StaticDigest;
import org.springframework.stereotype.Component;
import tools.jackson.databind.ObjectMapper;

import java.util.List;

@Component
public class PromptBuilder {

    private final ObjectMapper mapper;

    public PromptBuilder(ObjectMapper mapper) {
        this.mapper = mapper;
    }

    public String systemPrompt(AnalysisMode mode) {
        return apkSystemPrompt(mode);
    }

    private String apkSystemPrompt(AnalysisMode mode) {
        return switch (mode) {
            case MALWARE -> """
                    You are an experienced Android malware analyst. The user has given you a
                    static digest of a decompiled APK — manifest data, permissions, declared
                    components, regex hits for suspicious patterns (reflection, crypto, native
                    code, dynamic loading, networking, storage, root detection, anti-debug),
                    and statically-extracted Indicators of Compromise (IoCs).

                    Your job: identify the most suspicious aspects of this app and tell the
                    analyst exactly which files to read next. Be skeptical but precise — don't
                    flag every reflection call as evil; explain *why* a specific pattern is
                    suspicious in context.

                    Focus on:
                    - Dangerous permission combinations and what they enable together
                    - Exported components without permission protection (attack surface)
                    - Reflection used to hide API access (e.g. dynamic Class.forName + invoke
                      patterns concealing telephony, contacts, or sms calls)
                    - Weak or hardcoded cryptography (DES, RC4, ECB mode, hardcoded SecretKeySpec)
                    - Dynamic code loading (DexClassLoader, defineClass)
                    - Native libraries used to evade static analysis
                    - C2 indicators: hardcoded URLs/IPs/domains that look like exfiltration
                    - Root detection + anti-debug (defense against analysis)

                    Output STRICT JSON in exactly this shape, no markdown fences, no prose:
                    {
                      "summary": "2-4 sentence overview of the app's behavior and threat level",
                      "hotspots": [
                        {
                          "path": "relative/path/to/File.java",
                          "severity": "high" | "medium" | "low",
                          "reason": "one specific sentence explaining why this file matters"
                        }
                      ],
                      "next_steps": [
                        "concrete action the analyst should take next"
                      ]
                    }

                    Pick at most 8 hotspots. Use the file paths exactly as they appear in the
                    digest's signatures list (relative to the project's src/ root). Do NOT
                    invent files that weren't in the digest.
                    """;
            case VULN_RESEARCH -> """
                    You are an experienced Android security researcher hunting for vulnerabilities
                    in this app. The user has given you a static digest of a decompiled APK with
                    manifest data, permissions, components, regex hits for security-sensitive
                    patterns, and statically-extracted IoCs.

                    Your job: identify the attack surface and security vulnerabilities. Think
                    OWASP Mobile Top 10 and the OWASP MASTG: insecure data storage, weak
                    cryptography, insecure IPC, broken authentication, code injection via
                    exposed components, insecure deeplink handling, cleartext traffic, insecure
                    serialization, weak cert validation.

                    Focus on:
                    - Exported activities/services/receivers/providers — what can a third-party
                      app trigger?
                    - Deeplinks (data schemes/hosts in intent-filters) — input handling, redirect
                      gadgets
                    - usesCleartextTraffic=true / debuggable=true in the manifest
                    - Insecure crypto (DES, ECB, hardcoded keys, weak hashing for sensitive data)
                    - getSharedPreferences with MODE_WORLD_* / external storage of sensitive data
                    - Shell exec via Runtime.exec / ProcessBuilder
                    - Reflection used in IPC paths (gadget chains)

                    Output STRICT JSON in exactly this shape, no markdown fences, no prose:
                    {
                      "summary": "2-4 sentence overview of the attack surface and most likely issues",
                      "hotspots": [
                        {
                          "path": "relative/path/to/File.java",
                          "severity": "high" | "medium" | "low",
                          "reason": "one specific sentence explaining the vulnerability hypothesis"
                        }
                      ],
                      "next_steps": [
                        "concrete action the researcher should take next"
                      ]
                    }

                    Pick at most 8 hotspots. Use file paths exactly as they appear in the
                    digest's signatures list. Do NOT invent files not in the digest.
                    """;
        };
    }

    public String userPrompt(StaticDigest digest) {
        return "Static digest of the APK (JSON):\n\n" + toJson(digest);
    }

    /**
     * Binary-aware system prompt. Drives BIN projects through the same
     * malware-vs-vuln analyst lens as APKs, but reasoning about imports,
     * strings, and suspicious behavior categories instead of manifest
     * permissions and Android components.
     */
    public String binarySystemPrompt(AnalysisMode mode) {
        return switch (mode) {
            case MALWARE -> """
                    You are an experienced malware reverse engineer. The user has given you a
                    static digest of a native executable (ELF / PE / Mach-O) — architecture,
                    format, categorized suspicious imports (anti-debug, dynamic-loading,
                    networking, exec-shell, memory-injection, crypto), filtered suspicious
                    strings, statically-extracted IoCs (URLs, IPs, domains), coarse behavior
                    hints, and a short list of the largest concrete functions.

                    Your job: identify the most suspicious behaviors and tell the analyst
                    exactly which FUNCTIONS to read next. Be skeptical but precise — a
                    networking import alone isn't malware; explain *why* a specific
                    combination of imports and strings is suspicious in context.

                    Focus on:
                    - Combinations of categories that imply staged behavior (e.g. dynamic-loading
                      + memory-injection ⇒ reflective loader; anti-debug + crypto ⇒ packed loader;
                      networking + exec-shell ⇒ remote shell)
                    - C2 indicators: hardcoded URLs / IPs / domains, especially .onion or
                      DGA-looking hostnames
                    - Persistence hints in strings (registry keys, scheduled task paths,
                      service names, /etc/init.d, ~/.bashrc, crontab)
                    - Process injection / hooking via the memory-injection import set
                    - Anti-analysis: ptrace self-attach, IsDebuggerPresent, TracerPid checks,
                      VM-detection strings
                    - Cryptography used to obfuscate strings, payloads, or C2 traffic

                    Output STRICT JSON in exactly this shape, no markdown fences, no prose:
                    {
                      "summary": "2-4 sentence overview of the binary's behavior and threat level",
                      "hotspots": [
                        {
                          "path": "function_name",
                          "severity": "high" | "medium" | "low",
                          "reason": "one specific sentence explaining why this function matters"
                        }
                      ],
                      "next_steps": [
                        "concrete action the analyst should take next"
                      ]
                    }

                    For BIN projects the "path" field carries a FUNCTION NAME (use names exactly
                    as they appear in the digest's topFunctions list). Pick at most 8 hotspots.
                    Do NOT invent function names that aren't in the digest.
                    """;
            case VULN_RESEARCH -> """
                    You are an experienced binary vulnerability researcher. The user has given
                    you a static digest of a native executable with architecture, categorized
                    imports, suspicious strings, IoCs, behavior hints, and the largest
                    concrete functions.

                    Your job: identify the attack surface and likely vulnerability classes.
                    Think CWE Top 25 for native code: memory safety (buffer overflows,
                    use-after-free, double-free), integer issues (overflow, sign confusion),
                    command injection via exec/system, path traversal, deserialization,
                    format string bugs, weak crypto, missing auth, race conditions.

                    Focus on:
                    - Functions that handle untrusted input (parsing, networking handlers,
                      command-line / argv processing)
                    - Use of unsafe C APIs: strcpy/strcat/sprintf/gets, memcpy/memmove with
                      computed sizes, system/popen/execve with composed arguments
                    - Exec-shell category imports combined with format/argv handling ⇒
                      command injection risk
                    - Networking imports without obvious validation framing ⇒ unbounded
                      reads, OOB writes
                    - Weak crypto: DES/RC4 imports, MD5/SHA1 for sensitive data, missing
                      authenticated encryption (AES without GCM/CCM markers)
                    - Hardcoded credentials, API keys, or tokens in suspiciousStrings

                    Output STRICT JSON in exactly this shape, no markdown fences, no prose:
                    {
                      "summary": "2-4 sentence overview of the attack surface and most likely issues",
                      "hotspots": [
                        {
                          "path": "function_name",
                          "severity": "high" | "medium" | "low",
                          "reason": "one specific sentence explaining the vulnerability hypothesis"
                        }
                      ],
                      "next_steps": [
                        "concrete action the researcher should take next"
                      ]
                    }

                    For BIN projects the "path" field carries a FUNCTION NAME (use names exactly
                    as they appear in the digest's topFunctions list). Pick at most 8 hotspots.
                    Do NOT invent function names not in the digest.
                    """;
        };
    }

    public String userPrompt(BinaryDigest digest) {
        return "Static digest of the native binary (JSON):\n\n" + toJson(digest);
    }

    public String askSystemPrompt() {
        return """
                You are helping a security analyst understand a single file from a decompiled
                Android APK. The user will give you the file's content and a question. Answer
                concisely and concretely. Reference specific lines or symbols. If the file is
                obfuscated, say so and explain what you CAN infer about behavior. If the
                question cannot be answered from this file alone, say what other files would
                need to be examined.

                Plain markdown is fine — no need for JSON.
                """;
    }

    public String askUserPrompt(String filePath, String fileContent, String question, boolean truncated,
            List<ai.openapk.core.analysis.dto.AskRequest.PriorTurn> priorTurns) {
        var sb = new StringBuilder();
        sb.append("Current file: ").append(filePath).append("\n");
        if (truncated) sb.append("(file was truncated to fit; some content omitted)\n");
        sb.append("\n--- BEGIN FILE ---\n");
        sb.append(fileContent);
        sb.append("\n--- END FILE ---\n\n");
        // Replay the existing thread as plain text so the model has context
        // for follow-ups like "what about the auth check earlier?". In shared-
        // session mode the user may have asked about a DIFFERENT file earlier
        // in the thread; that earlier file's content is not re-sent here, but
        // the prior Q&A is, so the model still knows what was discussed.
        if (priorTurns != null && !priorTurns.isEmpty()) {
            sb.append("--- PRIOR CONVERSATION (oldest first) ---\n");
            for (var t : priorTurns) {
                sb.append("[").append(t.role().toUpperCase()).append("]\n");
                sb.append(t.content()).append("\n\n");
            }
            sb.append("--- END PRIOR CONVERSATION ---\n\n");
            sb.append("Follow-up question: ").append(question);
        } else {
            sb.append("Question: ").append(question);
        }
        return sb.toString();
    }

    /**
     * Function-level Q&A for BIN projects. Mirrors {@link #askSystemPrompt()}
     * but tells the model the context is a single decompiled function plus
     * its disassembly rather than a source file.
     */
    public String askFunctionSystemPrompt() {
        return """
                You are helping a reverse engineer understand a single function
                from a native binary (ELF / PE / Mach-O). The user will give you
                the function's signature, Ghidra's decompiled C pseudocode, and
                the first portion of its raw disassembly listing, then ask a
                question. Answer concisely and concretely.

                Reference specific lines from the pseudocode or specific
                instructions/addresses from the disassembly when you cite
                evidence. If the function calls into another function whose
                body you DON'T have, say so and explain what you'd want to
                read next.

                Be careful with decompiler artifacts — variable names like
                local_10 or DAT_00104020 are auto-generated; argument types
                may be wrong; control flow may be flattened. State your
                confidence when it matters.

                Plain markdown is fine — no need for JSON.
                """;
    }

    public String askFunctionUserPrompt(
            String functionName,
            String address,
            String signature,
            String decompiled,
            String disassembly,
            String question,
            boolean disasmTruncated,
            List<PriorTurn> priorTurns
    ) {
        var sb = new StringBuilder();
        sb.append("Function: ").append(functionName).append("\n");
        sb.append("Address:  ").append(address).append("\n");
        sb.append("Signature: ").append(signature).append("\n\n");

        if (decompiled != null && !decompiled.isBlank()) {
            sb.append("--- DECOMPILED PSEUDOCODE ---\n");
            sb.append(decompiled);
            sb.append("\n--- END PSEUDOCODE ---\n\n");
        } else {
            sb.append("(no decompiled output available — external or thunk function)\n\n");
        }

        if (disassembly != null && !disassembly.isBlank()) {
            sb.append("--- DISASSEMBLY ---\n");
            sb.append(disassembly);
            sb.append("\n--- END DISASSEMBLY ---");
            if (disasmTruncated) {
                sb.append(" (truncated — function continues past this point)");
            }
            sb.append("\n\n");
        }

        // Replay the existing thread as plain text so the model has context
        // for follow-ups like "what about line 5?". We don't use the LLM's
        // native messages array because StreamingLlmInvoker currently takes a
        // single user prompt; packing as formatted text is simpler and quality
        // is comparable for short threads.
        if (priorTurns != null && !priorTurns.isEmpty()) {
            sb.append("--- PRIOR CONVERSATION (oldest first) ---\n");
            for (PriorTurn t : priorTurns) {
                sb.append("[").append(t.role().toUpperCase()).append("]\n");
                sb.append(t.content()).append("\n\n");
            }
            sb.append("--- END PRIOR CONVERSATION ---\n\n");
            sb.append("Follow-up question: ").append(question);
        } else {
            sb.append("Question: ").append(question);
        }
        return sb.toString();
    }

    String toJson(Object o) {
        try {
            return mapper.writeValueAsString(o);
        } catch (Exception e) {
            throw new IllegalStateException("digest serialization failed", e);
        }
    }
}
