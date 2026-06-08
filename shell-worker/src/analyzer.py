"""Regex-based static analyzer for loose shell scripts. Rules mirror the
8-rule set from the npm and pypi workers, restated in shell idioms.

Why regex instead of AST? bash has no stdlib parser in Python; PowerShell's
canonical parser is .NET-only. Both are also fundamentally string-and-
process languages — the malicious patterns we care about (curl piped
into sh, IEX over DownloadString, base64-then-eval, env reads, persistence
writes) are surface-level lexical patterns that regex catches reliably.

Detected file kinds:
  - .ps1 / .psm1               → PowerShell
  - .sh / .bash / .zsh / .fish → POSIX-ish shell
  - any file with a shebang #!/bin/{sh,bash,zsh,dash} or #!pwsh — sniffed
    by the handler, kind passed in here

Each rule emits at most a small handful of findings per file to keep the
output readable; the worst offenders (eval-surface, secret-theft) cap at
the first ~10 matches.
"""

import math
import re


# ---------------------------------------------------------------------------
# Indicator tables — shared across PowerShell and POSIX paths


KNOWN_C2_PATTERNS = [
    re.compile(r"discord\.com/api/webhooks", re.I),
    re.compile(r"webhook\.site", re.I),
    re.compile(r"requestbin\.(net|com)", re.I),
    re.compile(r"pastebin\.com/raw", re.I),
    re.compile(r"transfer\.sh", re.I),
    re.compile(r"\bt\.me/[A-Za-z0-9_]+", re.I),
    re.compile(r"ipinfo\.io/(json|ip)", re.I),
    re.compile(r"workers\.dev/[a-z0-9-]+/(api|exfil|drop)", re.I),
    re.compile(r"\b[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+:[0-9]+\b"),  # raw ip:port
]

# Patterns common to BOTH shells — credential-path literals.
SENSITIVE_FS_PATTERNS = [
    re.compile(r"\.aws/credentials"),
    re.compile(r"\.aws/config"),
    re.compile(r"\.ssh/id_(rsa|ed25519|ecdsa|dsa)"),
    re.compile(r"\.ssh/authorized_keys"),
    re.compile(r"\.npmrc"),
    re.compile(r"\.docker/config\.json"),
    re.compile(r"\.gnupg"),
    re.compile(r"\.kube/config"),
    re.compile(r"/etc/passwd"),
    re.compile(r"/etc/shadow"),
    re.compile(r"Library/Keychains"),
    # PowerShell-specific: Credential Manager + DPAPI vault paths.
    re.compile(r"Microsoft\\Vault", re.I),
    re.compile(r"AppData\\Roaming\\Mozilla\\Firefox\\Profiles", re.I),
]

REMEDIATIONS = {
    "secret-theft": "Legit scripts rarely shell out for credential env vars or grep them from rc files. Audit caller.",
    "fs-traversal": "Scripts that read credential files outside their working dir should be treated as compromised.",
    "known-c2": "This indicator has appeared in known-bad droppers. Treat the script as malicious pending review.",
    "net-exfil": "Outbound HTTP from a shell script — especially to webhook hosts — is the most common dropper exfil shape.",
    "eval-surface": "iex / Invoke-Expression / eval / `bash <(curl)` execute remote code with no review path.",
    "spawn": "Subprocess spawns from a one-off script often indicate staged execution; check the caller.",
    "entropy-blob": "Long base64-looking literal — usually an encoded payload that downstream code decodes and executes.",
    "encoded-cmd": "Encoded commands hide the actual instructions from casual review. Decode and re-scan.",
    "persistence": "Writing to autoruns / cron / rc files turns a one-shot script into a long-running implant.",
    "install-hook": "Shell scripts don't have an install manifest, but a shebang or self-modifying file is a hook surface.",
}


# ---------------------------------------------------------------------------
# Rule sets — separated because PowerShell and POSIX use different syntax
# but conceptually overlap. Both lists feed into the same finding shape.


# (rule, severity, pattern, message-template)
POWERSHELL_RULES = [
    # eval-surface
    ("eval-surface", "HIGH", re.compile(r"\b[Ii]nvoke[-_][Ee]xpression\b|\bIEX\s*\(|\biex\s*\("),
     "Invoke-Expression / IEX — executes a string as code"),
    ("eval-surface", "HIGH", re.compile(r"\[scriptblock\]::Create\s*\(", re.I),
     "[scriptblock]::Create(...) constructs runnable code from a string"),
    ("eval-surface", "HIGH", re.compile(r"\bAdd-Type\s+-TypeDefinition", re.I),
     "Add-Type -TypeDefinition compiles + loads C# at runtime"),
    # spawn
    ("spawn", "HIGH", re.compile(r"\bStart-Process\b", re.I),
     "Start-Process launches an external program"),
    ("spawn", "HIGH", re.compile(r"\[System\.Diagnostics\.Process\]::Start", re.I),
     "[Process]::Start launches an external program via .NET"),
    # net-exfil
    ("net-exfil", "HIGH", re.compile(r"\b[Ii]nvoke[-_][Ww]eb[Rr]equest\b|\bIWR\s*\(|\biwr\s+"),
     "Invoke-WebRequest / IWR — outbound HTTP"),
    ("net-exfil", "HIGH", re.compile(r"\b[Ii]nvoke[-_][Rr]est[Mm]ethod\b|\bIRM\s*\(|\birm\s+"),
     "Invoke-RestMethod / IRM — outbound HTTP"),
    ("net-exfil", "HIGH", re.compile(r"Net\.WebClient", re.I),
     "Net.WebClient — outbound HTTP via .NET"),
    ("net-exfil", "HIGH", re.compile(r"DownloadString\s*\(|DownloadFile\s*\(", re.I),
     "WebClient DownloadString/DownloadFile — payload fetch"),
    ("net-exfil", "HIGH", re.compile(r"BitsAdmin|Start-BitsTransfer", re.I),
     "BITS transfer — outbound download often used to evade detection"),
    # encoded-cmd
    ("encoded-cmd", "CRITICAL", re.compile(r"powershell(?:\.exe)?\s+(?:-\w+\s+)*-(?:enc|ec|encodedcommand)\b", re.I),
     "powershell -EncodedCommand — base64-encoded command, classic evasion"),
    ("encoded-cmd", "CRITICAL", re.compile(r"\[Convert\]::FromBase64String", re.I),
     "[Convert]::FromBase64String — decoding a base64 payload"),
    # secret-theft (PS env syntax: $env:NAME)
    ("secret-theft", "CRITICAL", re.compile(r"\$env:(AWS_[A-Z_]*|NPM_TOKEN|GH(?:UB)?_TOKEN|DOCKER_[A-Z_]*|AZURE_[A-Z_]*|GCP_[A-Z_]*)", re.I),
     "Reads sensitive PowerShell env var"),
    ("secret-theft", "CRITICAL", re.compile(r"Get-Credential|Export-Clixml.*-Path.*credential", re.I),
     "Captures credentials via Get-Credential / Export-Clixml"),
    # persistence
    ("persistence", "CRITICAL", re.compile(r"Set-ItemProperty.*CurrentVersion\\(Run|RunOnce)", re.I),
     "Writes to HKCU/HKLM Run key — autorun persistence"),
    ("persistence", "CRITICAL", re.compile(r"New-Service|sc\.exe\s+create", re.I),
     "Creates a service — persistence"),
    ("persistence", "HIGH", re.compile(r"schtasks\s+/create|Register-ScheduledTask", re.I),
     "Creates a scheduled task — persistence"),
    ("persistence", "HIGH", re.compile(r"Add-MpPreference\s+-ExclusionPath", re.I),
     "Adds a Defender exclusion — common to hide a payload before execution"),
]

POSIX_RULES = [
    # eval-surface
    ("eval-surface", "HIGH", re.compile(r"\beval\s+"),
     "eval — executes its arguments as code"),
    ("eval-surface", "HIGH", re.compile(r"\bsource\s+<\(|\.\s+<\("),
     "source <(...) / `. <(...)` — runs process-substitution output as script"),
    ("eval-surface", "CRITICAL", re.compile(r"(?:curl|wget)\s+[^|;&]*\s*\|\s*(?:ba|z)?sh\b"),
     "curl|sh — fetch and pipe straight into shell, the canonical drive-by pattern"),
    ("eval-surface", "CRITICAL", re.compile(r"(?:ba|z)?sh\s+<\(\s*(?:curl|wget)\b"),
     "bash <(curl ...) — fetch and run with no review"),
    # spawn
    ("spawn", "HIGH", re.compile(r"\b(?:bash|sh|zsh|ksh)\s+-c\b"),
     "bash -c — runs a dynamic command string"),
    # net-exfil
    ("net-exfil", "HIGH", re.compile(r"\bcurl\s+[^|;&]*https?://"),
     "curl — outbound HTTP"),
    ("net-exfil", "HIGH", re.compile(r"\bwget\s+[^|;&]*https?://"),
     "wget — outbound HTTP"),
    # encoded-cmd
    ("encoded-cmd", "CRITICAL", re.compile(r"\bbase64\s+(?:-d|-D|--decode)\s*\|\s*(?:ba|z)?sh\b"),
     "base64 -d | sh — runs a decoded payload, classic obfuscation"),
    ("encoded-cmd", "HIGH", re.compile(r"\becho\s+[A-Za-z0-9+/=]{40,}\s*\|\s*base64\s+(?:-d|-D|--decode)"),
     "echo <long-b64> | base64 -d — staging a payload"),
    # secret-theft
    ("secret-theft", "CRITICAL", re.compile(r"\$\{?(AWS_[A-Z_]*|NPM_TOKEN|GH(?:UB)?_TOKEN|DOCKER_[A-Z_]*|AZURE_[A-Z_]*|GCP_[A-Z_]*)\}?"),
     "Reads sensitive shell env var"),
    ("secret-theft", "CRITICAL", re.compile(r"\bprintenv\s+(AWS_[A-Z_]*|NPM_TOKEN|GH(?:UB)?_TOKEN|DOCKER_[A-Z_]*)"),
     "printenv on a credential var"),
    # persistence
    ("persistence", "CRITICAL", re.compile(r">>\s*~?/?\.?(?:bashrc|zshrc|profile|bash_profile|zshenv)\b"),
     "Appends to a shell rc file — persistence on next login"),
    ("persistence", "CRITICAL", re.compile(r"\bcrontab\s+-\b|>>\s*/etc/cron|/etc/cron\.(?:d|hourly|daily|weekly)/"),
     "Writes to cron — persistence as a scheduled job"),
    ("persistence", "HIGH", re.compile(r"systemctl\s+(?:enable|start)|/etc/systemd/system/[^/]+\.service"),
     "Registers a systemd service — persistence"),
    ("persistence", "HIGH", re.compile(r"\bnohup\s+.+&\s*$", re.M),
     "nohup + & — long-running background process"),
]


# ---------------------------------------------------------------------------


def shannon_entropy(s: str) -> float:
    if not s:
        return 0.0
    freq: dict[str, int] = {}
    for c in s:
        freq[c] = freq.get(c, 0) + 1
    h = 0.0
    n = len(s)
    for count in freq.values():
        p = count / n
        h -= p * math.log2(p)
    return h


def analyze_source(source: str, file: str, language: str) -> list:
    """language ∈ {'powershell', 'posix'}."""
    rules = POWERSHELL_RULES if language == "powershell" else POSIX_RULES
    findings: list = []
    src_lines = source.splitlines()
    line_offsets = [0]
    for i, c in enumerate(source):
        if c == "\n":
            line_offsets.append(i + 1)

    def line_of(idx: int) -> int:
        lo, hi = 0, len(line_offsets) - 1
        while lo <= hi:
            mid = (lo + hi) // 2
            if line_offsets[mid] <= idx:
                lo = mid + 1
            else:
                hi = mid - 1
        return hi + 1

    def emit(rule, severity, idx, message, evidence=None):
        line = line_of(idx)
        snippet = ""
        if 0 < line <= len(src_lines):
            snippet = src_lines[line - 1].strip()[:200]
        findings.append({
            "rule": rule,
            "severity": severity,
            "file": file,
            "line": line,
            "column": 0,
            "message": message,
            "snippet": snippet,
            "remediation": REMEDIATIONS.get(rule, ""),
            "evidence": evidence or {},
            "deobfuscated": False,
        })

    # Language-specific rules — cap per-rule to keep output readable.
    PER_RULE_CAP = 5
    rule_hits: dict[str, int] = {}
    for rule, severity, pattern, message in rules:
        for m in pattern.finditer(source):
            if rule_hits.get(rule, 0) >= PER_RULE_CAP:
                break
            rule_hits[rule] = rule_hits.get(rule, 0) + 1
            emit(rule, severity, m.start(), message, {"match": m.group(0)[:120]})

    # Cross-language rules — fs-traversal + known-c2 + entropy-blob run on
    # the full source regardless of language (they're surface patterns).
    for rx in SENSITIVE_FS_PATTERNS:
        for m in rx.finditer(source):
            emit("fs-traversal", "CRITICAL", m.start(),
                 f"References sensitive filesystem path: {m.group(0)}",
                 {"path": m.group(0)})
            break  # one per pattern

    for rx in KNOWN_C2_PATTERNS:
        for m in rx.finditer(source):
            emit("known-c2", "CRITICAL", m.start(),
                 f"References known-bad indicator: {m.group(0)}",
                 {"indicator": m.group(0)})
            break

    # Entropy blob — look for long contiguous base64-alphabet runs.
    # Threshold 200 chars, entropy > 4.5 — same as the other workers.
    for m in re.finditer(r"[A-Za-z0-9+/=]{200,}", source):
        blob = m.group(0)
        h = shannon_entropy(blob)
        if h > 4.5:
            emit("entropy-blob", "INFO", m.start(),
                 f"Long high-entropy string (length {len(blob)}, entropy {h:.2f}) — possible encoded payload",
                 {"length": len(blob), "entropy": round(h, 2)})

    return findings
