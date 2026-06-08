"""Parse PyPI package manifests — setup.py, pyproject.toml, PKG-INFO,
*.dist-info/METADATA — to extract the same shape as the NPM
package-json-parser: name, version, hooks, dep count, parse errors.

The PyPI parallel of an `npm postinstall` hook is *setup.py executing
arbitrary code at install time*. We treat any of these as install-hook
findings:

  - top-level expression statements in setup.py that call dangerous
    primitives (eval/exec/subprocess/os.system/urllib.urlopen)
  - top-level `import os; os.system(...)` style sequences
  - a custom `cmdclass={'install': MyInstall}` override
  - a non-stdlib PEP-517 `build-backend`

setup.py parsing is *static* — we never run `exec(setup_py_source)`.
The whole point is to look at malicious setup.py code without executing
it.
"""

import ast
import os
import re

try:
    import tomllib  # Python 3.11+
except ImportError:  # pragma: no cover — Lambda is 3.12, fallback is paranoia
    tomllib = None


SAFE_BACKENDS = {
    "setuptools.build_meta",
    "setuptools.build_meta:__legacy__",
    "flit_core.buildapi",
    "poetry.core.masonry.api",
    "hatchling.build",
    "pdm.backend",
    "maturin",
}


def parse(extract_dir: str) -> dict:
    """Return the same dict shape NPM's package-json-parser emits, plus a
    `packageRoot` that lets the handler anchor file paths under it.

    PyPI sdists wrap the source in a single top-level dir (`pkg-1.2.3/`),
    so we walk shallowest-first to find it. Wheels put manifest data in
    `*.dist-info/METADATA` instead.
    """
    root = _find_package_root(extract_dir)
    if root is None:
        return _empty(extract_dir, "no setup.py / pyproject.toml / METADATA found")

    info = {
        "found": True,
        "packageRoot": root,
        "name": None,
        "version": None,
        "description": None,
        "maintainers": [],
        "dependencyCount": 0,
        "hasInstallHook": False,
        "hooks": [],
        "parseError": None,
    }

    setup_py = os.path.join(root, "setup.py")
    pyproject = os.path.join(root, "pyproject.toml")
    pkg_info = _find_metadata_file(root)

    # Order matters: pyproject is the modern source of truth, setup.py
    # supplements it (and is where install-time RCE lives), PKG-INFO /
    # METADATA fills in whatever's still blank.
    if os.path.isfile(pyproject):
        _merge_pyproject(info, pyproject)
    if os.path.isfile(setup_py):
        _merge_setup_py(info, setup_py)
    if pkg_info is not None:
        _merge_metadata(info, pkg_info)

    return info


def install_hook_findings(info: dict) -> list:
    """Mirror of NPM's installHookFindings — convert flagged hooks to a
    findings list. Severity escalation (HIGH → CRITICAL when the target
    file carries other CRITICAL findings) lives in the handler, same as
    the NPM side.
    """
    out = []
    for hook in info.get("hooks") or []:
        out.append({
            "rule": "install-hook",
            "severity": hook.get("severity", "MEDIUM"),
            "file": hook.get("file", "setup.py"),
            "line": hook.get("line", 0),
            "column": 0,
            "message": hook["message"],
            "snippet": hook.get("snippet", ""),
            "remediation": "Read the install-time code by hand — PyPI installs run setup.py with the user's interpreter. "
                           "Look for subprocess calls, network requests, or filesystem reads of credential paths.",
            "evidence": {"key": hook["key"], "script": hook.get("script", "")},
            "deobfuscated": False,
        })
    return out


# -----------------------------------------------------------------------


def _empty(root: str, err: str) -> dict:
    return {
        "found": False,
        "packageRoot": None,
        "name": None,
        "version": None,
        "description": None,
        "maintainers": [],
        "dependencyCount": 0,
        "hasInstallHook": False,
        "hooks": [],
        "parseError": err,
    }


def _find_package_root(extract_dir: str) -> str | None:
    """BFS for the shallowest dir containing setup.py, pyproject.toml,
    or PKG-INFO. Matches the NPM analyzer's `findShallowestPackageJson`
    in spirit — PyPI sdists are wrapped in `pkg-1.2.3/`, sometimes
    multiple levels deep, especially when users repack via the file
    picker (Datadog-style layouts go 3-4 levels in).
    """
    queue = [(extract_dir, 0)]
    best = None
    while queue:
        path, depth = queue.pop(0)
        if depth > 6:
            continue
        try:
            entries = list(os.scandir(path))
        except OSError:
            continue
        names = {e.name for e in entries}
        if names & {"setup.py", "pyproject.toml", "PKG-INFO"}:
            return path
        # Wheel layout: `pkg-1.2.3.dist-info/METADATA` lives one level down.
        for e in entries:
            if e.is_dir() and e.name.endswith(".dist-info"):
                if os.path.isfile(os.path.join(e.path, "METADATA")):
                    return path
        # If nothing found at this depth, queue children (skip noise dirs).
        for e in entries:
            if e.is_dir() and e.name not in {"__pycache__", ".git", "node_modules", ".tox", ".venv"}:
                queue.append((e.path, depth + 1))
    return best


def _find_metadata_file(root: str) -> str | None:
    pkg_info = os.path.join(root, "PKG-INFO")
    if os.path.isfile(pkg_info):
        return pkg_info
    for entry in os.scandir(root):
        if entry.is_dir() and entry.name.endswith(".dist-info"):
            meta = os.path.join(entry.path, "METADATA")
            if os.path.isfile(meta):
                return meta
    return None


def _merge_pyproject(info: dict, path: str) -> None:
    if tomllib is None:
        info["parseError"] = "tomllib unavailable"
        return
    try:
        with open(path, "rb") as f:
            data = tomllib.load(f)
    except Exception as e:
        info["parseError"] = f"pyproject.toml parse: {e}"
        return

    project = data.get("project", {})
    info["name"] = info["name"] or project.get("name")
    info["version"] = info["version"] or project.get("version")
    info["description"] = info["description"] or project.get("description")
    deps = project.get("dependencies", [])
    if isinstance(deps, list):
        info["dependencyCount"] = max(info["dependencyCount"], len(deps))
    for author in project.get("authors", []) or []:
        name = author.get("name") if isinstance(author, dict) else None
        if name:
            info["maintainers"].append(name)

    build_system = data.get("build-system", {})
    backend = build_system.get("build-backend")
    if backend and backend not in SAFE_BACKENDS:
        info["hasInstallHook"] = True
        info["hooks"].append({
            "key": "build-backend",
            "file": "pyproject.toml",
            "line": 0,
            "severity": "HIGH",
            "message": f"Custom PEP-517 build backend '{backend}' — runs during pip install.",
            "script": backend,
            "snippet": f"build-backend = \"{backend}\"",
        })


def _merge_setup_py(info: dict, path: str) -> None:
    try:
        with open(path, "r", encoding="utf-8", errors="replace") as f:
            source = f.read()
    except OSError as e:
        info["parseError"] = f"setup.py read: {e}"
        return

    try:
        tree = ast.parse(source, filename="setup.py")
    except SyntaxError as e:
        info["parseError"] = f"setup.py syntax: {e}"
        # Even with a syntax error, the file existing is itself a hook
        # surface — record that we tried.
        info["hasInstallHook"] = True
        info["hooks"].append({
            "key": "setup.py",
            "file": "setup.py",
            "line": 0,
            "severity": "HIGH",
            "message": "setup.py exists but failed to parse — manual review required (pip runs it as Python at install time).",
            "snippet": source[:160],
        })
        return

    setup_args = _find_setup_call(tree)
    if setup_args is not None:
        info["name"] = info["name"] or setup_args.get("name")
        info["version"] = info["version"] or setup_args.get("version")
        info["description"] = info["description"] or setup_args.get("description")
        author = setup_args.get("author") or setup_args.get("maintainer")
        if author and author not in info["maintainers"]:
            info["maintainers"].append(author)
        install_requires = setup_args.get("install_requires")
        if isinstance(install_requires, list):
            info["dependencyCount"] = max(info["dependencyCount"], len(install_requires))
        if setup_args.get("_has_cmdclass"):
            info["hasInstallHook"] = True
            info["hooks"].append({
                "key": "cmdclass",
                "file": "setup.py",
                "line": setup_args.get("_cmdclass_line", 0),
                "severity": "HIGH",
                "message": "Custom cmdclass override in setup() — install/build phases run user code.",
                "snippet": "setup(cmdclass=...)",
            })

    # Top-level RCE detection. setup.py is *expected* to call setup();
    # anything else at module level that touches subprocess/network/eval
    # is the PyPI parallel of `postinstall` running malicious JS.
    rce_hits = _detect_top_level_rce(tree, source)
    for hit in rce_hits:
        info["hasInstallHook"] = True
        info["hooks"].append({
            "key": "setup.py",
            "file": "setup.py",
            "line": hit["line"],
            "severity": "CRITICAL",
            "message": hit["message"],
            "script": hit["snippet"],
            "snippet": hit["snippet"],
        })


def _find_setup_call(tree: ast.Module) -> dict | None:
    """Locate the top-level `setup(...)` call and read its literal kwargs.
    Anything non-literal (a list comprehension, a variable reference) we
    just skip — we're never executing code, only reading what's there."""
    for node in tree.body:
        call = None
        if isinstance(node, ast.Expr) and isinstance(node.value, ast.Call):
            call = node.value
        elif isinstance(node, ast.Assign) and isinstance(node.value, ast.Call):
            call = node.value
        if call is None:
            continue
        fn_name = _call_name(call.func)
        if fn_name not in {"setup", "setuptools.setup", "distutils.core.setup"}:
            continue
        args: dict = {}
        for kw in call.keywords:
            if kw.arg is None:
                continue
            if kw.arg == "cmdclass":
                args["_has_cmdclass"] = True
                args["_cmdclass_line"] = kw.value.lineno if hasattr(kw.value, "lineno") else 0
                continue
            val = _literal_or_none(kw.value)
            if val is not None:
                args[kw.arg] = val
        return args
    return None


def _call_name(node: ast.AST) -> str:
    if isinstance(node, ast.Name):
        return node.id
    if isinstance(node, ast.Attribute):
        return f"{_call_name(node.value)}.{node.attr}"
    return ""


def _literal_or_none(node: ast.AST):
    try:
        return ast.literal_eval(node)
    except (ValueError, SyntaxError):
        return None


_RCE_FUNCS = {
    "eval", "exec", "compile",
    "os.system", "os.popen",
    "subprocess.run", "subprocess.call", "subprocess.Popen",
    "subprocess.check_call", "subprocess.check_output", "subprocess.getoutput",
    "urllib.request.urlopen", "urllib.urlopen",
    "requests.get", "requests.post", "requests.put",
    "httpx.get", "httpx.post",
    "socket.socket", "socket.create_connection",
}


def _detect_top_level_rce(tree: ast.Module, source: str) -> list:
    """Walk the module body and flag any non-import statement that calls
    one of the dangerous primitives without being guarded by
    `if __name__ == '__main__':`. The guard is the convention PyPI
    expects — code inside it doesn't run during `pip install`.
    """
    src_lines = source.splitlines()
    hits = []
    for node in tree.body:
        if isinstance(node, (ast.Import, ast.ImportFrom, ast.FunctionDef,
                              ast.AsyncFunctionDef, ast.ClassDef)):
            continue
        # Skip `if __name__ == '__main__':` blocks — convention says nothing
        # under that branch runs during install.
        if isinstance(node, ast.If) and _is_main_guard(node.test):
            continue
        # Walk this statement looking for dangerous calls.
        for sub in ast.walk(node):
            if not isinstance(sub, ast.Call):
                continue
            name = _call_name(sub.func)
            if name in _RCE_FUNCS or any(name.endswith("." + f.split(".")[-1]) for f in _RCE_FUNCS):
                line = getattr(sub, "lineno", 0)
                snippet = src_lines[line - 1].strip() if 0 < line <= len(src_lines) else ""
                hits.append({
                    "line": line,
                    "message": f"setup.py runs {name}(...) at module level — executes during pip install.",
                    "snippet": snippet[:200],
                })
                break  # one hit per top-level statement is enough
    return hits


def _is_main_guard(test: ast.AST) -> bool:
    if not isinstance(test, ast.Compare):
        return False
    if not (isinstance(test.left, ast.Name) and test.left.id == "__name__"):
        return False
    if not test.comparators:
        return False
    right = test.comparators[0]
    return isinstance(right, ast.Constant) and right.value == "__main__"


# -----------------------------------------------------------------------
# METADATA / PKG-INFO (RFC822-ish key/value file)


_META_RX = re.compile(r"^([A-Za-z][A-Za-z0-9-]*):\s*(.*)$")


def _merge_metadata(info: dict, path: str) -> None:
    try:
        with open(path, "r", encoding="utf-8", errors="replace") as f:
            content = f.read()
    except OSError as e:
        info["parseError"] = info["parseError"] or f"PKG-INFO read: {e}"
        return

    name = version = description = None
    author = maintainer = None
    requires = 0
    for raw in content.splitlines():
        m = _META_RX.match(raw)
        if not m:
            continue
        key, val = m.group(1).lower(), m.group(2).strip()
        if key == "name" and not name:
            name = val
        elif key == "version" and not version:
            version = val
        elif key == "summary" and not description:
            description = val
        elif key == "author" and not author:
            author = val
        elif key == "maintainer" and not maintainer:
            maintainer = val
        elif key == "requires-dist":
            requires += 1

    info["name"] = info["name"] or name
    info["version"] = info["version"] or version
    info["description"] = info["description"] or description
    if author and author not in info["maintainers"]:
        info["maintainers"].append(author)
    if maintainer and maintainer not in info["maintainers"]:
        info["maintainers"].append(maintainer)
    info["dependencyCount"] = max(info["dependencyCount"], requires)
