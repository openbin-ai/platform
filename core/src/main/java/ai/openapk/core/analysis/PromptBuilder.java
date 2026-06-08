package ai.openapk.core.analysis;

import ai.openapk.core.analysis.dto.AskFunctionRequest.PriorTurn;
import ai.openapk.core.analysis.dto.BinaryDigest;
import ai.openapk.core.analysis.dto.StaticDigest;
import ai.openapk.core.script.dto.ScriptAnalysisFindings;
import org.springframework.stereotype.Component;
import tools.jackson.databind.ObjectMapper;

import java.util.ArrayList;
import java.util.List;
import java.util.Map;

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

    /**
     * Script-aware system prompt. Drives SCRIPT (NPM tarball) projects
     * through the same malware-vs-vuln analyst lens, reasoning about
     * the 8 rule categories the script-worker Lambda emits plus the
     * package's install hooks. Output JSON shape stays consistent with
     * APK + BIN so the downstream report editor renders the result the
     * same way; "path" carries "file:line" instead of a function name.
     */
    public String scriptSystemPrompt(AnalysisMode mode) {
        return switch (mode) {
            case MALWARE -> """
                    You are an experienced software supply-chain security analyst. The user has
                    given you the output of a static analyzer that scanned an NPM tarball for
                    malicious patterns. The findings list covers eight rule categories:
                    install-hook, secret-theft, fs-traversal, net-exfil, eval-surface, spawn,
                    entropy-blob, and known-c2. Each finding carries a severity, file:line,
                    message, code snippet, and rule-specific evidence.

                    Your job: triage the package. Decide whether the findings represent a
                    coordinated malicious install-time payload, a benign-but-noisy package,
                    or something in between. Be skeptical but precise — a single eval() in
                    a build tool isn't malware; install-hook + secret-theft + net-exfil in
                    the same file almost certainly is.

                    Focus on:
                    - Coordinated patterns inside the install hook target: install-hook +
                      secret-theft + net-exfil in install.js or postinstall.js is the
                      canonical supply-chain attack shape (event-stream, ua-parser-js).
                    - Encoded payloads (entropy-blob, especially when the deobfuscator
                      successfully reversed obfuscator.io transforms — see deobfuscated:true).
                    - Whether the exfiltration endpoint is a known abuse host (known-c2
                      finding) versus a possibly-legitimate first-party domain.
                    - Whether the spawn / eval surface lives on a hot install path or in a
                      runtime-only branch the developer would have to trigger.

                    Output STRICT JSON in exactly this shape, no markdown fences, no prose:
                    {
                      "summary": "2-4 sentence overview of the package's risk and suspected intent",
                      "hotspots": [
                        {
                          "path": "relative/path.js:LINE",
                          "severity": "high" | "medium" | "low",
                          "reason": "one specific sentence explaining why this line matters"
                        }
                      ],
                      "next_steps": [
                        "concrete action the analyst should take next"
                      ]
                    }

                    For SCRIPT projects the "path" field MUST carry the file path followed by
                    ":LINE" (use file + line exactly as they appear in the findings array).
                    Pick at most 8 hotspots. Do NOT invent file paths or rule names not in the
                    findings.
                    """;
            case VULN_RESEARCH -> """
                    You are an experienced NPM ecosystem security researcher. The user has
                    given you static-analyzer findings on an NPM tarball — eight rule
                    categories covering install hooks, secret access, filesystem traversal,
                    network exfiltration, eval surface, process spawning, encoded payloads,
                    and known command-and-control indicators.

                    Your job: identify the attack surface the package exposes to its
                    DOWNSTREAM users. A SCRIPT project differs from a deployed app: a
                    vulnerability here propagates to every project that runs `npm install`
                    on this package. Think dependency confusion, install-hook RCE,
                    credential theft chains, prototype pollution surfaces, and unsafe
                    dynamic require() patterns that turn the package into a code-injection
                    vector for the consuming application.

                    Focus on:
                    - Dynamic require/eval combined with user-supplied input shapes in the
                      package's public API (a downstream developer can drive code execution).
                    - Install-hook scripts that probe the host environment in ways that hint
                      at multi-stage payloads (timing checks, OS sniffing).
                    - Hardcoded credentials, tokens, or API keys exposed in the package source.
                    - Prototype pollution risks: assignments to __proto__, constructor.prototype,
                      or computed-property writes derived from untrusted input.

                    Output STRICT JSON in exactly this shape, no markdown fences, no prose:
                    {
                      "summary": "2-4 sentence overview of the supply-chain attack surface",
                      "hotspots": [
                        {
                          "path": "relative/path.js:LINE",
                          "severity": "high" | "medium" | "low",
                          "reason": "one specific sentence explaining the vulnerability hypothesis"
                        }
                      ],
                      "next_steps": [
                        "concrete action the researcher should take next"
                      ]
                    }

                    For SCRIPT projects the "path" field MUST carry the file path followed by
                    ":LINE". Use file + line exactly as they appear in the findings array.
                    Pick at most 8 hotspots. Do NOT invent file paths or rule names not in the
                    findings.
                    """;
        };
    }

    /**
     * Build the user prompt for a SCRIPT analysis. Bundles the package
     * metadata + a severity-ordered findings table; for HIGH/CRITICAL
     * findings we include the snippet inline so the model doesn't have
     * to make up evidence. The full findings JSON is also attached for
     * the model to inspect — keeps the prompt under a few KB while
     * surfacing the most decision-relevant signal at the top.
     */
    public String userPrompt(ScriptAnalysisFindings findings) {
        StringBuilder sb = new StringBuilder();
        sb.append("Script analyzer findings (JSON):\n\n");

        // Quick-scan summary table at the top — the model is biased
        // toward whatever shows up first in the prompt, so we lead with
        // the decision-relevant aggregates.
        if (findings.summary() != null) {
            var s = findings.summary();
            var pkg = s.pkg();
            sb.append("# Package\n");
            if (pkg != null) {
                if (pkg.name() != null) sb.append("- name: ").append(pkg.name()).append("\n");
                if (pkg.version() != null) sb.append("- version: ").append(pkg.version()).append("\n");
                if (pkg.description() != null && !pkg.description().isBlank()) {
                    sb.append("- description: ").append(pkg.description()).append("\n");
                }
                if (pkg.dependencyCount() != null) {
                    sb.append("- dependencies: ").append(pkg.dependencyCount()).append("\n");
                }
                if (Boolean.TRUE.equals(pkg.hasInstallHook())) {
                    sb.append("- install-hooks: ");
                    if (pkg.installHooks() != null) {
                        for (var h : pkg.installHooks()) {
                            sb.append(h.key()).append(" => ").append(h.script()).append("; ");
                        }
                    }
                    sb.append("\n");
                }
            }
            sb.append("\n# Severity counts\n");
            if (s.countsBySeverity() != null) {
                for (var entry : s.countsBySeverity().entrySet()) {
                    if (entry.getValue() != null && entry.getValue() > 0) {
                        sb.append("- ").append(entry.getKey()).append(": ").append(entry.getValue()).append("\n");
                    }
                }
            }
            sb.append("- files scanned: ").append(s.fileCount()).append("\n");
            sb.append("- deobfuscated files: ").append(s.deobfuscatedFileCount()).append("\n\n");
        }

        // Inline the highest-severity findings with their snippets so the
        // model can cite specific code without re-deriving it. Cap to 12
        // to keep the prompt bounded — the rest are reachable via the
        // full JSON dump below.
        if (findings.findings() != null) {
            sb.append("# Top findings (with snippets)\n");
            int shown = 0;
            for (var f : findings.findings()) {
                if (!"CRITICAL".equals(f.severity()) && !"HIGH".equals(f.severity())) continue;
                if (shown++ >= 12) break;
                sb.append("- [").append(f.severity()).append("] ").append(f.rule())
                  .append(" — ").append(f.file()).append(":").append(f.line()).append("\n");
                sb.append("    ").append(f.message()).append("\n");
                if (f.snippet() != null && !f.snippet().isBlank()) {
                    sb.append("    code: `").append(truncate(f.snippet(), 240)).append("`\n");
                }
                if (Boolean.TRUE.equals(f.deobfuscated())) {
                    sb.append("    (source was deobfuscated before this rule fired)\n");
                }
            }
            sb.append("\n");
        }

        sb.append("# Full findings JSON\n").append(toJson(findings)).append("\n");
        return sb.toString();
    }

    /**
     * Extracts IoCs (URL / domain) from script findings — the known-c2
     * and net-exfil rules carry concrete network indicators in their
     * evidence map. Returned in the same {@link ai.openapk.core.analysis.dto.Ioc}
     * shape AnalysisService already caches for APK + BIN, so the
     * downstream cache + IoC-tab rendering Just Works for SCRIPT too.
     */
    public List<ai.openapk.core.analysis.dto.Ioc> iocsFromFindings(ScriptAnalysisFindings findings) {
        List<ai.openapk.core.analysis.dto.Ioc> out = new ArrayList<>();
        if (findings == null || findings.findings() == null) return out;
        java.util.LinkedHashMap<String, Integer> counts = new java.util.LinkedHashMap<>();
        for (var f : findings.findings()) {
            Map<String, Object> ev = f.evidence();
            if (ev == null) continue;
            // known-c2: evidence.indicator carries the offending string
            Object indicator = ev.get("indicator");
            if (indicator instanceof String s && !s.isBlank()) {
                counts.merge(s, 1, Integer::sum);
            }
            // net-exfil: evidence.target carries the URL (when literal)
            Object target = ev.get("target");
            if (target instanceof String t && !t.isBlank()) {
                counts.merge(t, 1, Integer::sum);
            }
        }
        for (var entry : counts.entrySet()) {
            out.add(new ai.openapk.core.analysis.dto.Ioc("url", entry.getKey(), entry.getValue()));
        }
        return out;
    }

    private static String truncate(String s, int max) {
        if (s == null) return "";
        String clean = s.replace('\n', ' ').replace('\r', ' ').trim();
        return clean.length() > max ? clean.substring(0, max - 1) + "…" : clean;
    }

    /**
     * Per-file Q&A for SCRIPT (NPM tarball / loose JS) projects. The model
     * is told it's looking at code from an UNTRUSTED package — bias toward
     * "spot the malicious patterns" rather than the more neutral framing
     * the APK ask uses. Findings already produced by the static analyzer
     * are passed in as additional context so the model can build on them
     * instead of re-deriving the same observations.
     */
    public String askScriptSystemPrompt() {
        return askScriptSystemPrompt("npm");
    }

    /**
     * Ecosystem-aware system prompt for the Ask-AI panel on SCRIPT projects.
     * The malicious patterns differ between npm and PyPI — different install
     * hooks, different credential paths, different exfil libraries — so we
     * emit different briefings depending on which worker produced the
     * findings JSON. Unrecognized values fall back to npm (the JS-1 default).
     */
    public String askScriptSystemPrompt(String ecosystem) {
        boolean pypi = ecosystem != null && ecosystem.equalsIgnoreCase("pypi");
        boolean shell = ecosystem != null && ecosystem.equalsIgnoreCase("shell");
        if (shell) {
            return """
                    You are helping a security analyst review a single shell script (PowerShell
                    or POSIX bash/sh) that may be a dropper or first-stage loader. The user will
                    give you the file's content, a list of static-analyzer findings already
                    raised on this file, and a question. Answer concisely and concretely.

                    Bias your reasoning toward malicious-dropper patterns:
                    - drive-by execution: `curl http://x | sh`, `bash <(curl ...)`,
                      `IEX((New-Object Net.WebClient).DownloadString(...))`, `iwr | iex`
                    - encoded commands: `powershell -EncodedCommand <b64>`,
                      `[Convert]::FromBase64String(...)`, `echo <b64> | base64 -d | bash`
                    - credential theft: `$env:AWS_*` / `$AWS_SECRET_ACCESS_KEY` reads;
                      grepping `~/.aws/credentials`, `~/.ssh/id_*`, `~/.npmrc`,
                      `~/.docker/config.json`, Credential Manager / DPAPI vaults
                    - exfiltration: outbound HTTP to webhook hosts, Telegram bots,
                      requestbin / pastebin; `Net.WebClient`, `Invoke-WebRequest`,
                      `BitsAdmin`, `curl|wget` to non-vendor domains
                    - process spawning: `Start-Process`, `[Process]::Start`, `bash -c`,
                      `sh -c` from a script that has no good reason to fork
                    - persistence: writes to Run keys, scheduled tasks, services,
                      Defender exclusions (PS); cron, systemd unit files, rc-file
                      appends, `nohup ... &` (POSIX)
                    - environment evasion: `if ($env:USERNAME -eq ...)` /
                      `if [ "$HOSTNAME" = ... ]` guards that gate the payload to a
                      single victim

                    Reference specific lines, cmdlets, or commands. Note when a finding is
                    enough to call the script malicious on its own (e.g. an encoded
                    powershell -enc payload paired with a webhook URL). If the question
                    cannot be answered from this file alone, say what other artifacts
                    (the dropped payload, network logs) would be needed.

                    Plain markdown is fine — no need for JSON.
                    """;
        }
        if (pypi) {
            return """
                    You are helping a security analyst review a single file from an UNTRUSTED
                    PyPI package (or loose Python script). The user will give you the file's
                    content, a list of static-analyzer findings already raised on this file,
                    and a question. Answer concisely and concretely.

                    Bias your reasoning toward malicious Python supply-chain patterns:
                    - install-time payloads: top-level code in setup.py runs when pip
                      installs the package; custom cmdclass overrides; non-stdlib PEP-517
                      build backends; import-time RCE in __init__.py
                    - secret theft: os.environ reads of credential names (AWS_*, TWINE_*,
                      PYPI_*, NPM_TOKEN, GH_TOKEN); reads of ~/.aws/credentials,
                      ~/.pypirc, ~/.ssh/*, ~/.docker/config.json, browser cookie DBs
                    - exfiltration: urllib.request.urlopen / requests / httpx /
                      socket.connect to webhook hosts (Discord, Telegram, requestbin)
                    - dynamic code execution: eval / exec / compile / __import__ with a
                      computed name; importlib.import_module on a string from the network
                    - obfuscation primitives: base64 / zlib / marshal / codecs.decode
                      blobs fed into exec; Fernet-encrypted bytes decoded at runtime
                    - process spawning: subprocess.{run,Popen,call} with shell=True,
                      os.system, os.popen — especially at module level or in setup.py

                    Reference specific lines, function names, or imports. If the question
                    cannot be answered from this file alone, say what other files (or what
                    runtime evidence) would be needed.

                    Plain markdown is fine — no need for JSON.
                    """;
        }
        return """
                You are helping a security analyst review a single file from an UNTRUSTED
                NPM package (or loose JavaScript / TypeScript). The user will give you the
                file's content, a list of static-analyzer findings already raised on this
                file, and a question. Answer concisely and concretely.

                Bias your reasoning toward malicious-supply-chain patterns:
                - install-time payloads (preinstall / postinstall hooks)
                - secret theft (process.env reads of credential names, ~/.aws/credentials,
                  ~/.npmrc, ~/.ssh/*, browser cookie databases)
                - exfiltration (fetch / http.request / dgram to webhook hosts, Telegram
                  bots, Discord webhooks, IP-info services)
                - dynamic code execution (eval, new Function, vm.runIn*, dynamic require)
                - obfuscation primitives (numeric-array decoders, Caesar / XOR over
                  charcodes, base64-then-eval, packed obfuscator.io output)
                - process spawning at install or import time

                If the file was deobfuscated before this conversation (the prompt will
                say so), treat the decoded payload as authoritative and explain what it
                actually does. Reference specific lines or function names. If the question
                cannot be answered from this file alone, say what other files (or what
                runtime evidence) would be needed.

                Plain markdown is fine — no need for JSON.
                """;
    }

    /** User-side prompt for SCRIPT ask. Includes the file content + a compact list of
     *  on-file findings + the user's question + replay of any prior thread. */
    public String askScriptUserPrompt(
            String filePath,
            String fileContent,
            boolean deobfuscated,
            List<ai.openapk.core.script.dto.ScriptAnalysisFindings.Finding> onFileFindings,
            String question,
            boolean truncated,
            List<ai.openapk.core.analysis.dto.AskRequest.PriorTurn> priorTurns
    ) {
        var sb = new StringBuilder();
        sb.append("Current file: ").append(filePath).append("\n");
        if (deobfuscated) sb.append("(this is the DEOBFUSCATED version — the original was an obfuscated dropper)\n");
        if (truncated) sb.append("(file was truncated to fit; some content omitted)\n");

        if (onFileFindings != null && !onFileFindings.isEmpty()) {
            sb.append("\n--- STATIC ANALYZER FINDINGS ON THIS FILE ---\n");
            for (var f : onFileFindings) {
                sb.append("- [").append(f.severity()).append("] ").append(f.rule())
                  .append(" at line ").append(f.line())
                  .append(": ").append(f.message()).append("\n");
            }
            sb.append("--- END FINDINGS ---\n");
        }

        sb.append("\n--- BEGIN FILE ---\n");
        sb.append(fileContent);
        sb.append("\n--- END FILE ---\n\n");

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
