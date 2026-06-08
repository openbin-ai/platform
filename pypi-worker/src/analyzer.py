"""8-rule Python AST analyzer — direct parallel of script-worker/analyzer.js
but operating on `ast` nodes instead of Babel nodes.

Rules (severity order CRITICAL > HIGH > MEDIUM > INFO):
  1. secret-theft   (CRITICAL) — os.environ.get('AWS_*'), os.environ['NPM_TOKEN'], etc.
  2. fs-traversal   (CRITICAL) — string literal contains '~/.aws/credentials', etc.
  3. known-c2       (CRITICAL) — string literal matches known-bad indicator list
  4. net-exfil      (HIGH)     — urllib / requests / httpx / socket call
  5. eval-surface   (HIGH)     — eval / exec / compile / __import__(<computed>)
  6. spawn          (HIGH)     — subprocess / os.system / os.popen with shell=True
  7. install-hook   (HIGH/MEDIUM) — emitted by manifest_parser, severity decided in handler
  8. entropy-blob   (INFO)     — long high-entropy string literal (encoded payload?)
"""

import ast
import math
import re


SENSITIVE_ENV_PATTERNS = [
    re.compile(r"^AWS_"),
    re.compile(r"^NPM_TOKEN$"),
    re.compile(r"^GH_TOKEN$"),
    re.compile(r"^GITHUB_TOKEN$"),
    re.compile(r"^DOCKER_"),
    re.compile(r"^NODE_AUTH_TOKEN$"),
    re.compile(r"^CIRCLECI_TOKEN$"),
    re.compile(r"^CODECOV_TOKEN$"),
    re.compile(r"^VAULT_"),
    re.compile(r"^GCP_"),
    re.compile(r"^GOOGLE_APPLICATION_CREDENTIALS$"),
    re.compile(r"^AZURE_"),
    re.compile(r"^SSH_"),
    re.compile(r"^STRIPE_"),
    re.compile(r"^TWILIO_"),
    re.compile(r"^SENDGRID_"),
    re.compile(r"^SLACK_TOKEN$"),
    # PyPI-specific credential vars worth flagging too.
    re.compile(r"^PYPI_"),
    re.compile(r"^TWINE_"),
    re.compile(r"^POETRY_"),
]

SENSITIVE_FS_PATTERNS = [
    re.compile(r"\.aws/credentials"),
    re.compile(r"\.aws/config"),
    re.compile(r"\.ssh/id_"),
    re.compile(r"\.ssh/authorized_keys"),
    re.compile(r"\.npmrc"),
    re.compile(r"\.yarnrc"),
    re.compile(r"\.docker/config\.json"),
    re.compile(r"\.gnupg"),
    re.compile(r"\.gpg"),
    re.compile(r"\.env(?!\w)"),
    re.compile(r"\.kube/config"),
    re.compile(r"/etc/passwd"),
    re.compile(r"/etc/shadow"),
    re.compile(r"Library/Keychains"),
    # PyPI-specific credentials worth flagging.
    re.compile(r"\.pypirc"),
    re.compile(r"pip/pip\.conf"),
    re.compile(r"poetry/auth\.toml"),
]

KNOWN_C2_PATTERNS = [
    re.compile(r"discord\.com/api/webhooks", re.I),
    re.compile(r"webhook\.site", re.I),
    re.compile(r"requestbin\.(net|com)", re.I),
    re.compile(r"pastebin\.com/raw", re.I),
    re.compile(r"transfer\.sh", re.I),
    re.compile(r"\bt\.me/[A-Za-z0-9_]+", re.I),
    re.compile(r"ipinfo\.io/(json|ip)", re.I),
    re.compile(r"npmjs\.help", re.I),
    re.compile(r"workers\.dev/[a-z0-9-]+/(api|exfil|drop)", re.I),
]

SUSPICIOUS_NET_HOSTS = [
    re.compile(r"\d+\.\d+\.\d+\.\d+"),
    re.compile(r"\b[a-z0-9-]+\.onion\b"),
    re.compile(r"paste(bin|rs)?\.", re.I),
    re.compile(r"bit\.ly|tinyurl\.com|t\.co"),
]


REMEDIATIONS = {
    "secret-theft": "Legitimate packages rarely read credential env vars directly. Audit the call site.",
    "fs-traversal": "Packages should not reach into a developer's home directory. Inspect why this path appears.",
    "known-c2": "This indicator has been seen in known-malicious supply-chain packages. Treat as compromised pending review.",
    "net-exfil": "Verify the destination is documented for this package. Outbound calls at import time are suspicious.",
    "eval-surface": "Dynamic code execution is a red flag in a library. Confirm whether the path is reachable from import or install.",
    "spawn": "Process spawning at import or install time can run arbitrary local commands. Look for the calling context.",
    "entropy-blob": "High-entropy strings often hide encoded payloads (base64 / hex). Decode and re-scan if suspicious.",
    "install-hook": "setup.py / pyproject.toml runs at install time. Audit the target before trusting the package.",
}


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


def analyze_source(source: str, file: str, deobf_flag: bool = False) -> list:
    """Parse source with Python's ast and emit findings. Returns [] on
    syntax errors — same silent-skip behavior as the JS side."""
    try:
        tree = ast.parse(source, filename=file)
    except SyntaxError:
        return []

    findings: list = []
    src_lines = source.splitlines()

    def push(rule: str, severity: str, node: ast.AST, message: str, evidence: dict | None = None) -> None:
        line = getattr(node, "lineno", 0) or 0
        col = getattr(node, "col_offset", 0) or 0
        snippet = ""
        if 0 < line <= len(src_lines):
            snippet = src_lines[line - 1].strip()[:160]
        findings.append({
            "rule": rule,
            "severity": severity,
            "file": file,
            "line": line,
            "column": col,
            "message": message,
            "snippet": snippet,
            "remediation": REMEDIATIONS.get(rule, ""),
            "evidence": evidence or {},
            "deobfuscated": deobf_flag,
        })

    for node in ast.walk(tree):
        # --- secret-theft -------------------------------------------------
        # os.environ['AWS_X'], os.environ.get('AWS_X'), os.getenv('AWS_X')
        if isinstance(node, ast.Subscript):
            base = _dotted_name(node.value)
            if base == "os.environ":
                key = _string_const(node.slice)
                if key and any(rx.search(key) for rx in SENSITIVE_ENV_PATTERNS):
                    push("secret-theft", "CRITICAL", node,
                         f"Reads sensitive environment variable {key}",
                         {"envVar": key})

        if isinstance(node, ast.Call):
            name = _dotted_name(node.func)
            if name in {"os.environ.get", "os.getenv"} and node.args:
                key = _string_const(node.args[0])
                if key and any(rx.search(key) for rx in SENSITIVE_ENV_PATTERNS):
                    push("secret-theft", "CRITICAL", node,
                         f"Reads sensitive environment variable {key}",
                         {"envVar": key})

            # --- eval-surface --------------------------------------------
            if name == "eval" or (isinstance(node.func, ast.Name) and node.func.id == "eval"):
                push("eval-surface", "HIGH", node,
                     "eval() call — executes arbitrary code at runtime",
                     {"kind": "eval"})
            elif name == "exec" or (isinstance(node.func, ast.Name) and node.func.id == "exec"):
                push("eval-surface", "HIGH", node,
                     "exec() call — runs Python source from a string",
                     {"kind": "exec"})
            elif name == "compile" or (isinstance(node.func, ast.Name) and node.func.id == "compile"):
                push("eval-surface", "HIGH", node,
                     "compile() call — compiles source to executable code object",
                     {"kind": "compile"})
            elif name == "__import__" and node.args and _string_const(node.args[0]) is None:
                push("eval-surface", "HIGH", node,
                     "__import__() called with a non-literal name — dynamic import",
                     {"kind": "dynamic-import"})
            elif name in {"importlib.import_module"} and node.args and _string_const(node.args[0]) is None:
                push("eval-surface", "HIGH", node,
                     "importlib.import_module called with a non-literal name",
                     {"kind": "dynamic-import"})

            # --- spawn ----------------------------------------------------
            if name in {
                "os.system", "os.popen", "os.execv", "os.execvp",
                "subprocess.run", "subprocess.call", "subprocess.Popen",
                "subprocess.check_call", "subprocess.check_output", "subprocess.getoutput",
                "subprocess.getstatusoutput",
            } or (isinstance(node.func, ast.Name) and node.func.id in {"Popen", "system"}):
                shell_true = False
                for kw in node.keywords or []:
                    if kw.arg == "shell" and isinstance(kw.value, ast.Constant) and kw.value.value is True:
                        shell_true = True
                push("spawn", "HIGH", node,
                     f"{name}(...) invocation" + (" with shell=True" if shell_true else ""),
                     {"call": name, "shellTrue": shell_true})

            # --- net-exfil ------------------------------------------------
            if name in {
                "urllib.request.urlopen", "urllib.urlopen",
                "requests.get", "requests.post", "requests.put", "requests.delete",
                "requests.request",
                "httpx.get", "httpx.post", "httpx.put", "httpx.delete",
                "aiohttp.ClientSession",
                "socket.create_connection", "socket.socket",
            }:
                target = None
                if node.args:
                    target = _string_const(node.args[0])
                # Skip plain localhost.
                if target and re.match(r"^https?://(localhost|127\.0\.0\.1)", target):
                    pass
                else:
                    suspicious = bool(target and any(rx.search(target) for rx in SUSPICIOUS_NET_HOSTS))
                    push("net-exfil", "HIGH", node,
                         f"{name}() call" + (f" to {target}" if target else ""),
                         {"call": name, "target": target, "suspiciousTarget": suspicious})

        # --- string literals: fs-traversal, known-c2, entropy-blob ------
        if isinstance(node, ast.Constant) and isinstance(node.value, str):
            v = node.value
            if not v:
                continue
            if any(rx.search(v) for rx in SENSITIVE_FS_PATTERNS):
                push("fs-traversal", "CRITICAL", node,
                     f"String literal references sensitive filesystem path: {v}",
                     {"path": v})
            if any(rx.search(v) for rx in KNOWN_C2_PATTERNS):
                push("known-c2", "CRITICAL", node,
                     f"String literal matches a known-bad command-and-control indicator: {v}",
                     {"indicator": v})
            if len(v) > 200:
                h = shannon_entropy(v)
                if h > 4.5:
                    push("entropy-blob", "INFO", node,
                         f"Long high-entropy string literal (length {len(v)}, entropy {h:.2f}) — possible encoded payload",
                         {"length": len(v), "entropy": round(h, 2)})

    return findings


# -----------------------------------------------------------------------


def _dotted_name(node: ast.AST | None) -> str | None:
    """Reduce a Name/Attribute chain to dotted form: `os.environ.get`."""
    if node is None:
        return None
    if isinstance(node, ast.Name):
        return node.id
    if isinstance(node, ast.Attribute):
        left = _dotted_name(node.value)
        if left is None:
            return None
        return f"{left}.{node.attr}"
    return None


def _string_const(node: ast.AST | None) -> str | None:
    if isinstance(node, ast.Constant) and isinstance(node.value, str):
        return node.value
    # Python 3.9+ wraps slice constants in ast.Constant directly; no need for
    # the legacy ast.Index node.
    return None
