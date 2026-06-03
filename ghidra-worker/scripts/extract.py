# -*- coding: utf-8 -*-
# Ghidra headless post-script: dump functions + strings + imports as JSON.
#
# Invoked by analyzeHeadless via:
#   -postScript extract.py <output.json>
#
# Runs in Jython 2.7 -- no f-strings, no type hints, parens-print works.
# Module-level code only, because Ghidra's injected globals (currentProgram,
# monitor, getScriptArgs) don't carry into nested function scopes cleanly.
#
# IMPORTANT: analyzeHeadless's exit code reflects the analysis, NOT the
# post-script. If this script throws, analyzeHeadless still exits 0 and the
# caller (worker/main.py) sees no result.json. To stay debuggable, every
# code path here either writes result.json with the real extract OR writes
# {"error": "..."} so the worker can surface the cause.
#
# Output shape on success (consumed by NativeAnalysisService for the JNI-bridge
# flow and by BinaryDecompileService for full BIN projects):
#   {
#     "functions": [{
#         name, address, size, signature,
#         decompiled,                              # C pseudocode (null for external/thunk)
#         disassembly: [{addr, text}, ...],        # per-instruction listing (null for external/thunk)
#         xrefs: {callers: [name, ...], callees: [name, ...]},
#         external, thunk
#     }, ...],
#     "strings":   ["...", ...],
#     "imports":   ["malloc", ...],
#     "metadata":  {compiler, language, executable_format, image_base, *_count}
#   }
# On failure:
#   {"error": "<message + traceback>"}
#@category OpenAPK

import json
import traceback

MAX_FUNCTIONS = 5000
MAX_STRINGS = 5000
MAX_IMPORTS = 2000
MIN_STRING_LEN = 4
DECOMPILE_TIMEOUT_SEC = 60
# Caps on the per-function payload. Disassembly is by far the biggest
# contributor to result.json size -- a single 5000-instruction function is
# ~250KB of mnemonics alone. Truncate aggressively; the AI layer doesn't need
# the long tail, and a user reading the disasm view will tolerate "(truncated)"
# on a gigafunction. Callers/callees are dedup-by-name and capped per
# direction so a hotpath function with thousands of callers stays bounded.
MAX_DISASM_LINES_PER_FUNCTION = 5000
MAX_XREFS_PER_DIRECTION = 50


def _safe(thunk, default=None):
    try:
        return thunk()
    except:
        return default


def _write(out_path, payload):
    f = open(out_path, "w")
    try:
        json.dump(payload, f)
    finally:
        f.close()


# ---------- arg + program preflight ----------
try:
    args = getScriptArgs()
except Exception, e:  # noqa: E722  (Jython 2 syntax)
    # If getScriptArgs itself fails we have no out_path to write to.
    println("[extract] FATAL: getScriptArgs unavailable: " + str(e))
    raise SystemExit(1)

if len(args) < 1:
    println("[extract] FATAL: need output path as first arg")
    raise SystemExit(1)
OUT_PATH = args[0]

println("[extract] start, out=" + str(OUT_PATH))

# From here on, ANY failure must be caught and serialized as an error JSON.
try:
    program = currentProgram
    if program is None:
        _write(OUT_PATH, {"error": "no current program (analyzeHeadless did not import a binary)"})
        println("[extract] no current program")
        raise SystemExit(0)

    from ghidra.app.decompiler import DecompInterface, DecompileOptions

    # ---------- Functions + decompiled C + disassembly + xrefs ----------
    decompiler = DecompInterface()
    decompiler.setOptions(DecompileOptions())
    decompiler.openProgram(program)

    listing = program.getListing()

    functions = []
    fm = program.getFunctionManager()
    fn_iter = fm.getFunctions(True)  # forward=True
    while fn_iter.hasNext():
        if monitor.isCancelled():
            break
        if len(functions) >= MAX_FUNCTIONS:
            break
        fn = fn_iter.next()
        name = fn.getName()
        addr = str(fn.getEntryPoint())
        body = fn.getBody()
        size = body.getNumAddresses() if body is not None else 0
        sig = _safe(lambda: fn.getSignature(True).getPrototypeString(), "")
        is_external = bool(fn.isExternal())
        is_thunk = bool(fn.isThunk())

        decompiled = None
        disassembly = None
        if not is_external and not is_thunk:
            # Decompiled C pseudocode (Ghidra's main view).
            try:
                res = decompiler.decompileFunction(fn, DECOMPILE_TIMEOUT_SEC, monitor)
                if res is not None and res.decompileCompleted():
                    dfn = res.getDecompiledFunction()
                    if dfn is not None:
                        decompiled = dfn.getC()
            except:
                decompiled = None

            # Per-instruction disassembly listing. Walked via listing.getInstructions
            # rather than the decompiler so what the user sees in the disasm
            # tab matches what they'd see in the Ghidra GUI's Listing view
            # (post auto-analysis, with operand markup).
            disassembly = []
            try:
                ins_iter = listing.getInstructions(body, True)
                while ins_iter.hasNext():
                    if len(disassembly) >= MAX_DISASM_LINES_PER_FUNCTION:
                        disassembly.append({"addr": "", "text": "; (disassembly truncated)"})
                        break
                    ins = ins_iter.next()
                    disassembly.append({
                        "addr": str(ins.getAddress()),
                        "text": ins.toString(),
                    })
            except:
                # Don't fail the whole function record on a bad disasm walk --
                # decompiled C and xrefs may still be useful on their own.
                disassembly = None

        # Cross-references. Both directions use Ghidra's high-level function
        # API rather than raw reference walks so indirect/thunk patterns are
        # resolved consistently with the Listing view. External functions
        # legitimately have callers (the binary's import slots are called
        # from real code), so we compute xrefs for them too.
        xrefs_callers = []
        xrefs_callees = []
        try:
            callers = fn.getCallingFunctions(monitor)
            if callers is not None:
                cit = callers.iterator()
                seen = set()
                while cit.hasNext():
                    if len(xrefs_callers) >= MAX_XREFS_PER_DIRECTION:
                        break
                    c = cit.next()
                    cname = c.getName()
                    if cname in seen:
                        continue
                    seen.add(cname)
                    xrefs_callers.append(cname)
        except:
            xrefs_callers = []
        try:
            if not is_external:
                callees = fn.getCalledFunctions(monitor)
                if callees is not None:
                    cit = callees.iterator()
                    seen = set()
                    while cit.hasNext():
                        if len(xrefs_callees) >= MAX_XREFS_PER_DIRECTION:
                            break
                        c = cit.next()
                        cname = c.getName()
                        if cname in seen:
                            continue
                        seen.add(cname)
                        xrefs_callees.append(cname)
        except:
            xrefs_callees = []

        functions.append({
            "name": name,
            "address": addr,
            "size": size,
            "signature": sig,
            "decompiled": decompiled,
            "disassembly": disassembly,
            "xrefs": {"callers": xrefs_callers, "callees": xrefs_callees},
            "external": is_external,
            "thunk": is_thunk,
        })

    println("[extract] functions: " + str(len(functions)))

    # ---------- Strings (defined string-shaped data) ----------
    strings = []
    seen_strings = set()
    listing = program.getListing()
    data_iter = listing.getDefinedData(True)
    while data_iter.hasNext():
        if monitor.isCancelled():
            break
        if len(strings) >= MAX_STRINGS:
            break
        d = data_iter.next()
        try:
            if not d.hasStringValue():
                continue
            rep = d.getDefaultValueRepresentation()
            if rep is None:
                continue
            # Ghidra wraps string literals in matching quotes -- strip them.
            if len(rep) >= 2 and rep[0] in ('"', "'") and rep[-1] == rep[0]:
                rep = rep[1:-1]
            if len(rep) < MIN_STRING_LEN:
                continue
            if rep in seen_strings:
                continue
            seen_strings.add(rep)
            strings.append(rep)
        except:
            pass

    println("[extract] strings: " + str(len(strings)))

    # ---------- Imports (external functions referenced) ----------
    imports = []
    seen_imports = set()
    sym_table = program.getSymbolTable()
    ext_iter = sym_table.getExternalSymbols()
    while ext_iter.hasNext():
        if len(imports) >= MAX_IMPORTS:
            break
        s = ext_iter.next()
        nm = s.getName()
        if nm and nm not in seen_imports:
            seen_imports.add(nm)
            imports.append(nm)

    println("[extract] imports: " + str(len(imports)))

    # ---------- Metadata ----------
    metadata = {
        "compiler":          _safe(lambda: program.getCompiler(), ""),
        "language":          _safe(lambda: str(program.getLanguageID()), ""),
        "executable_format": _safe(lambda: program.getExecutableFormat(), ""),
        "image_base":        _safe(lambda: str(program.getImageBase()), ""),
        "function_count":    len(functions),
        "string_count":      len(strings),
        "import_count":      len(imports),
    }

    result = {
        "functions": functions,
        "strings":   strings,
        "imports":   imports,
        "metadata":  metadata,
    }

    _write(OUT_PATH, result)
    println("[extract] wrote " + OUT_PATH +
            " functions=" + str(len(functions)) +
            " strings=" + str(len(strings)) +
            " imports=" + str(len(imports)))

except SystemExit:
    raise
except Exception, e:  # noqa: E722
    tb = traceback.format_exc()
    println("[extract] FAILED: " + str(e))
    println(tb)
    try:
        _write(OUT_PATH, {"error": str(e) + "\n" + tb})
    except Exception, write_err:
        println("[extract] could not even write error JSON: " + str(write_err))
