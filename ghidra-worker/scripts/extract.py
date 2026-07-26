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
#         line_map: [[lineNo, [addr, ...]], ...],  # decompiled-C line -> instruction addrs (cross-highlight)
#         vars: [{name, addrs: [addr, ...]}, ...], # decompiled variable -> instruction addrs (cross-highlight)
#         xrefs: {callers: [name, ...], callees: [name, ...]},
#         external, thunk
#     }, ...],
#     "strings":       ["...", ...],
#     "imports":       ["malloc", ...],
#     "exports":       [{name, address}, ...],     # exported symbols + entry points with real names
#     "entry_points":  [{name, address}, ...],     # binary's actual entry symbols (DllMainCRTStartup, _start, etc.)
#     "tls_callbacks": [{name, address}, ...],     # PE TLS directory callbacks (anti-debug hook surface)
#     "data_symbols":  [{name, address, type}, ...], # DAT_* and named globals — for click-through from decompiled C
#     "memory_blocks": [{name, start, end, size, permissions, executable, initialized}, ...],
#     "metadata":      {compiler, language, executable_format, image_base, *_count}
#   }
# On failure:
#   {"error": "<message + traceback>"}
#@category OpenAPK

import json
import os
import re
import time
import traceback

# Identifier shape for decompiled variable names (uVar1, param_1, local_18,
# in_EAX, ...). ClangVariableToken also covers constant + global operands
# (Ghidra models them as varnodes), so we filter `vars` to this shape to keep
# only real locals/params — constants (0x1a, 8) and punctuated data names
# (.rdata, s_Foo:_..) are dropped; data symbols are navigable separately.
_IDENT_RE = re.compile(r"^[A-Za-z_][A-Za-z0-9_]*$")

# Function-record cap: huge so navigation works on big binaries (silentXMR-
# class XMR miners can have 10k+ functions). Each metadata-only record is
# tiny (~200B), so 50k caps result.json's fn-metadata at <10MB even worst
# case. Decompile/disasm bodies are gated by a separate, lower cap.
MAX_FUNCTIONS = 50000
# Bodies cap: only the first N functions get decompiled + disassembled.
# A typical function body is 1-10KB; sized so the bulk of real binaries
# (silentXMR-class miners, big stripped libs) get full coverage but a
# pathological 100k-function blob still terminates with a bounded JSON.
# Functions are iterated forward-by-address — future work could BFS from
# entry points so the body budget is spent on call-graph-reachable code
# instead of being address-order biased.
MAX_DECOMPILE_BODIES = 15000
MAX_STRINGS = 5000
MAX_IMPORTS = 2000
MAX_EXPORTS = 5000
MAX_DATA_SYMBOLS = 20000
MAX_TLS_CALLBACKS = 64
MAX_MEMORY_BLOCKS = 256
MIN_STRING_LEN = 4
# Per-function decompile ceiling. A single function that takes this long is
# almost always pathological (obfuscated dispatch loop, giant switch); real
# code decompiles in well under a second. Kept modest so a handful of such
# functions can't each burn a big slice of the shared wall-clock budget — the
# old 90s let ~a dozen gigafunctions alone blow the whole analysis past its cap.
DECOMPILE_TIMEOUT_SEC = 45
# Absolute wall-clock deadline (epoch seconds) for the decompile phase, handed
# down by the worker (app/main.py) as GHIDRA_EXTRACT_DEADLINE_EPOCH. Once the
# remaining budget drops below one function's decompile ceiling we STOP
# decompiling new bodies and stub the rest (body_skipped=True, same UI stub as
# the size-cap path) — every function is still LISTED, we just don't have time
# to give them all bodies. This turns the old hard 504 (whole subprocess killed,
# nothing salvaged) into a usable partial result. None => no deadline (older
# worker, or an unbounded manual run): behaves exactly as before.
_EXTRACT_DEADLINE = None
try:
    _dl = os.environ.get("GHIDRA_EXTRACT_DEADLINE_EPOCH")
    if _dl:
        _EXTRACT_DEADLINE = float(_dl)
except:
    _EXTRACT_DEADLINE = None
# Caps on the per-function payload. Disassembly is by far the biggest
# contributor to result.json size -- a single 5000-instruction function is
# ~250KB of mnemonics alone. Truncate aggressively; the AI layer doesn't need
# the long tail, and a user reading the disasm view will tolerate "(truncated)"
# on a gigafunction. Callers/callees are dedup-by-name and capped per
# direction so a hotpath function with thousands of callers stays bounded.
MAX_DISASM_LINES_PER_FUNCTION = 5000
MAX_XREFS_PER_DIRECTION = 50
# Cross-highlight maps (Ghidra-style "follow along"): per decompiled function
# we emit a decompiled-line -> instruction-address map and a variable ->
# instruction-address map, both walked from the decompiler's ClangToken
# markup. Capped so a pathological gigafunction can't blow the JSON: addrs
# per line and per variable are deduped + bounded, and the number of distinct
# variables tracked per function is capped.
MAX_LINEMAP_ADDRS = 64
MAX_VARS_PER_FUNCTION = 512
MAX_VAR_ADDRS = 256
# Data-symbol byte capture. Raised from 64 so an embedded config/table (a
# 2KB global_conf, an RC4 sbox, a cert blob) is captured whole — enough for the
# analysis/AI layer to decode a small hardcoded secret straight from the JSON
# without the raw sample. Bounded three ways so a big .data section can't
# unbound result.json:
#   - MAX_DATA_VALUE_BYTES        per-symbol cap (a single giant blob truncates)
#   - MIN_DATA_VALUE_BYTES        floor kept for EVERY symbol once the global
#                                 budget is spent (UI/nav never goes blank)
#   - MAX_TOTAL_DATA_PREVIEW_BYTES global budget across all symbols; past it,
#                                 remaining symbols fall back to the floor
# Worst case data-symbol contribution ≈ budget + floor×remaining, well under the
# function-body budget that already dominates the JSON.
MAX_DATA_VALUE_BYTES = 4096
MIN_DATA_VALUE_BYTES = 64
MAX_TOTAL_DATA_PREVIEW_BYTES = 512 * 1024


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
    # ClangVariableToken is the leaf token class for decompiled-C variables
    # (locals + params: uVar1, param_1, local_18, ...). Used to build the
    # variable -> instruction-address map for cross-highlighting. Imported
    # defensively: if the symbol is missing on some Ghidra build, var maps
    # are simply skipped (line maps still work).
    try:
        from ghidra.app.decompiler import ClangVariableToken
    except:
        ClangVariableToken = None

    # ---------- Functions + decompiled C + disassembly + xrefs ----------
    decompiler = DecompInterface()
    decompiler.setOptions(DecompileOptions())
    decompiler.openProgram(program)

    listing = program.getListing()

    functions = []
    decompile_budget_hit = 0     # bodies skipped by the MAX_DECOMPILE_BODIES size cap
    decompile_time_skipped = 0   # bodies skipped because the wall-clock budget ran out
    time_budget_exhausted = False
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

        # Wall-clock guard: once too little budget remains to safely run one
        # more decompile (which can take up to DECOMPILE_TIMEOUT_SEC), stop
        # decompiling NEW bodies. The metadata-stub loop below is fast and
        # still runs for every remaining function, so the binary stays fully
        # navigable and result.json still gets written before the worker's
        # hard subprocess timeout. Latch it so we don't re-check every row.
        if _EXTRACT_DEADLINE is not None and not time_budget_exhausted:
            if time.time() + DECOMPILE_TIMEOUT_SEC > _EXTRACT_DEADLINE:
                time_budget_exhausted = True
                println("[extract] decompile time budget exhausted after " +
                        str(len(functions)) + " functions; stubbing the rest")

        # Decompile/disassemble only the first MAX_DECOMPILE_BODIES non-
        # external/non-thunk functions, and only while wall-clock budget
        # remains. Everything else gets a metadata-only stub so it remains
        # clickable in the UI's function list and cross-references resolve,
        # but the body is null (UI shows "decompile not available" empty
        # state). This lets giant binaries stay navigable without blowing the
        # JSON payload size OR the analysis wall-clock.
        decompile_this = (
            not is_external and not is_thunk
            and len(functions) < MAX_DECOMPILE_BODIES
            and not time_budget_exhausted
        )
        decompiled = None
        disassembly = None
        # Cross-highlight maps. line_map: [[lineNo, [addr, ...]], ...] mapping
        # each 1-based decompiled-C line to the instruction addresses it came
        # from. vars: [{"name", "addrs": [...]}, ...] mapping each decompiled
        # variable to the instructions that reference it. Both null when the
        # function isn't decompiled or the markup walk fails (the UI then
        # degrades to no cross-highlight). Addresses are str(Address) -- the
        # SAME formatting as disassembly[].addr -- so the frontend can match
        # them directly against disasm rows.
        line_map = None
        var_refs = None
        if decompile_this:
            # Decompiled C pseudocode (Ghidra's main view).
            res = None
            try:
                res = decompiler.decompileFunction(fn, DECOMPILE_TIMEOUT_SEC, monitor)
                if res is not None and res.decompileCompleted():
                    dfn = res.getDecompiledFunction()
                    if dfn is not None:
                        decompiled = dfn.getC()
            except:
                decompiled = None

            # Walk the decompiler's ClangToken markup to correlate decompiled
            # lines + variables to machine addresses. Each leaf ClangToken
            # carries getLineParent().getLineNumber() (1-based, aligns with
            # getC()) and getMinAddress() (the instruction the token came
            # from). This is the data Ghidra's GUI uses for its own
            # token<->listing highlighting; we export a compacted form.
            if decompiled is not None and res is not None:
                try:
                    markup = res.getCCodeMarkup()  # ClangTokenGroup root, may be None
                    if markup is not None:
                        line_addrs = {}     # lineNo -> [addr, ...] (ordered, deduped)
                        var_addrs = {}      # name   -> [addr, ...] (ordered, deduped)
                        var_order = []      # preserve first-seen variable order
                        # Iterative DFS preserving document order; recursion
                        # could blow Jython's stack on a huge token tree.
                        stack = [markup]
                        leaves = []
                        while stack:
                            node = stack.pop()
                            nc = _safe(lambda: node.numChildren(), 0) or 0
                            if nc == 0:
                                leaves.append(node)
                            else:
                                for i in range(nc - 1, -1, -1):
                                    stack.append(node.Child(i))
                        for tok in leaves:
                            lp = _safe(lambda: tok.getLineParent(), None)
                            lineno = _safe(lambda: lp.getLineNumber(), None) if lp is not None else None
                            a = _safe(lambda: tok.getMinAddress(), None)
                            addr_s = str(a) if a is not None else None
                            if addr_s is None:
                                continue
                            if lineno is not None:
                                lst = line_addrs.get(lineno)
                                if lst is None:
                                    lst = []
                                    line_addrs[lineno] = lst
                                if addr_s not in lst and len(lst) < MAX_LINEMAP_ADDRS:
                                    lst.append(addr_s)
                            if ClangVariableToken is not None and isinstance(tok, ClangVariableToken):
                                nm = _safe(lambda: tok.getText(), None)
                                if nm and _IDENT_RE.match(nm):
                                    vlst = var_addrs.get(nm)
                                    if vlst is None:
                                        if len(var_order) >= MAX_VARS_PER_FUNCTION:
                                            continue
                                        vlst = []
                                        var_addrs[nm] = vlst
                                        var_order.append(nm)
                                    if addr_s not in vlst and len(vlst) < MAX_VAR_ADDRS:
                                        vlst.append(addr_s)
                        line_map = [[ln, line_addrs[ln]] for ln in sorted(line_addrs.keys())]
                        var_refs = [{"name": nm, "addrs": var_addrs[nm]} for nm in var_order]
                except:
                    line_map = None
                    var_refs = None

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

        # `body_skipped`: true when the function was eligible for decompile
        # but we skipped it because the per-result MAX_DECOMPILE_BODIES
        # budget was already spent. Distinct from external/thunk (no body
        # to decompile) so the UI can show "click to request on-demand
        # decompile" vs "this is a stub" later.
        body_skipped = (not is_external and not is_thunk and not decompile_this)
        if body_skipped:
            if time_budget_exhausted:
                decompile_time_skipped += 1
            else:
                decompile_budget_hit += 1
        functions.append({
            "name": name,
            "address": addr,
            "size": size,
            "signature": sig,
            "decompiled": decompiled,
            "disassembly": disassembly,
            "line_map": line_map,
            "vars": var_refs,
            "xrefs": {"callers": xrefs_callers, "callees": xrefs_callees},
            "external": is_external,
            "thunk": is_thunk,
            "body_skipped": body_skipped,
        })

    println("[extract] functions: " + str(len(functions)) +
            " (decompile_budget_skipped=" + str(decompile_budget_hit) +
            " decompile_time_skipped=" + str(decompile_time_skipped) + ")")

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

    # ---------- Entry points + exports ----------
    # External entry points = addresses Ghidra marks as program entries.
    # For a PE this is DllMainCRTStartup / mainCRTStartup plus every exported
    # function; for ELF it's _start plus shared-object exports. We split into
    # two views:
    #   entry_points: every marked entry, named or auto-named (FUN_*/SUB_*).
    #     This is the user's "where do I start reading?" anchor.
    #   exports:      the subset with real (non-placeholder) names — i.e. the
    #     public API surface the binary exposes to its loader/host.
    entry_points = []
    exports = []
    seen_exports = set()
    try:
        ep_iter = sym_table.getExternalEntryPointIterator()
        while ep_iter.hasNext():
            ep_addr = ep_iter.next()
            ep_sym = sym_table.getPrimarySymbol(ep_addr)
            name = ep_sym.getName() if ep_sym is not None else ""
            entry_points.append({
                "name": name,
                "address": str(ep_addr),
            })
            # Treat as export iff the symbol carries a real name (not one of
            # Ghidra's address-suffixed placeholders). Anything with a curated
            # name almost certainly came from a PE export table, ELF dynsym,
            # or user rename — exactly the surface we want highlighted.
            if name and not (name.startswith("FUN_") or name.startswith("SUB_") or name.startswith("LAB_")):
                if name not in seen_exports and len(exports) < MAX_EXPORTS:
                    seen_exports.add(name)
                    exports.append({"name": name, "address": str(ep_addr)})
    except Exception as e:
        # A silent `pass` here once hid a nonexistent-API call for weeks
        # (getExternalEntryPoints vs getExternalEntryPointIterator) — always
        # leave a trace in the headless log.
        println("[extract] WARNING: entry/export extraction failed: " + repr(e))

    println("[extract] entry_points: " + str(len(entry_points)) +
            " exports: " + str(len(exports)))

    # ---------- TLS callbacks (PE only) ----------
    # Ghidra labels TLS callback functions as TlsCallback_NN by convention.
    # These run before DllMain on PE binaries and are a classic
    # anti-debug / anti-analysis hook surface — malware (XMR miners
    # included) frequently stashes early-execution logic here.
    tls_callbacks = []
    try:
        seen_tls = set()
        all_syms = sym_table.getAllSymbols(True)
        while all_syms.hasNext():
            if len(tls_callbacks) >= MAX_TLS_CALLBACKS:
                break
            s = all_syms.next()
            nm = s.getName()
            if nm and nm.startswith("TlsCallback_") and nm not in seen_tls:
                seen_tls.add(nm)
                tls_callbacks.append({"name": nm, "address": str(s.getAddress())})
    except:
        pass

    println("[extract] tls_callbacks: " + str(len(tls_callbacks)))

    # ---------- Data symbols (DAT_* and named globals) ----------
    # Walks every defined-data location and emits its primary symbol +
    # type display name. This is what powers DAT_xxx click-through in the
    # decompiled view: a reference to DAT_140ae8d00 in the C output can
    # be resolved here to its address + Ghidra-inferred type.
    #
    # We deliberately do NOT filter to only DAT_-prefixed names — user
    # renames of global data should remain navigable too.
    data_symbols = []
    seen_data_addrs = set()
    total_data_bytes = 0  # running sum of captured preview bytes (global budget)
    try:
        data_iter = listing.getDefinedData(True)
        while data_iter.hasNext():
            if monitor.isCancelled():
                break
            if len(data_symbols) >= MAX_DATA_SYMBOLS:
                break
            d = data_iter.next()
            addr_str = str(d.getAddress())
            if addr_str in seen_data_addrs:
                continue
            seen_data_addrs.add(addr_str)
            sym = sym_table.getPrimarySymbol(d.getAddress())
            nm = sym.getName() if sym is not None else ""
            if not nm:
                continue
            try:
                dt_str = d.getDataType().getDisplayName()
            except:
                dt_str = ""
            # Default value representation -- this is the same string Ghidra
            # would render in the Listing view ("0x42", "12345", "\"hello\"",
            # etc). Lets the DataDetail UI surface "what is this DAT_xxx
            # actually" without us reconstructing the formatter.
            try:
                value_repr = d.getDefaultValueRepresentation() or ""
            except:
                value_repr = ""
            # Raw byte preview as space-separated hex pairs. Useful for
            # arrays / structs where the typed representation is opaque
            # ("undefined[64]") -- the user can still eyeball the magic.
            bytes_preview = ""
            try:
                d_len = d.getLength()
                if d_len > 0:
                    # Per-symbol cap drops to the floor once the global budget is
                    # spent, so a large .data section can't unbound the JSON;
                    # every symbol still keeps at least the floor for the UI.
                    cap = MAX_DATA_VALUE_BYTES
                    if total_data_bytes >= MAX_TOTAL_DATA_PREVIEW_BYTES:
                        cap = MIN_DATA_VALUE_BYTES
                    n = d_len if d_len < cap else cap
                    raw = d.getBytes()
                    if raw is not None:
                        hex_parts = []
                        for i in range(n):
                            # Java bytes are signed; mask to unsigned before formatting.
                            hex_parts.append("%02x" % (raw[i] & 0xff))
                        bytes_preview = " ".join(hex_parts)
                        if d_len > n:
                            bytes_preview += " ..."
                        total_data_bytes += n
            except:
                bytes_preview = ""
            # Caller count -- lets the UI flag "hot" globals at a glance.
            try:
                ref_count = sym.getReferenceCount() if sym is not None else 0
            except:
                ref_count = 0
            try:
                size_val = d.getLength()
            except:
                size_val = 0
            data_symbols.append({
                "name":          nm,
                "address":       addr_str,
                "type":          dt_str,
                "size":          size_val,
                "value":         value_repr,
                "bytes_preview": bytes_preview,
                "ref_count":     ref_count,
            })
    except:
        pass

    println("[extract] data_symbols: " + str(len(data_symbols)))

    # ---------- Memory blocks (sections) ----------
    # Mirrors what Ghidra GUI's Memory Map window shows: every named region
    # the loader mapped, with its permission triple. The frontend uses this
    # to (a) render a sections panel, and (b) classify an address as code-
    # vs data-region when resolving a click on a raw hex literal.
    memory_blocks = []
    try:
        mem = program.getMemory()
        for blk in mem.getBlocks():
            if len(memory_blocks) >= MAX_MEMORY_BLOCKS:
                break
            try:
                size_val = blk.getSize()
            except:
                size_val = 0
            memory_blocks.append({
                "name":        blk.getName(),
                "start":       str(blk.getStart()),
                "end":         str(blk.getEnd()),
                "size":        size_val,
                "permissions": ("r" if blk.isRead() else "-") +
                                ("w" if blk.isWrite() else "-") +
                                ("x" if blk.isExecute() else "-"),
                "executable":  bool(blk.isExecute()),
                "initialized": bool(blk.isInitialized()),
            })
    except:
        pass

    println("[extract] memory_blocks: " + str(len(memory_blocks)))

    # ---------- Metadata ----------
    metadata = {
        "compiler":          _safe(lambda: program.getCompiler(), ""),
        "language":          _safe(lambda: str(program.getLanguageID()), ""),
        "executable_format": _safe(lambda: program.getExecutableFormat(), ""),
        "image_base":        _safe(lambda: str(program.getImageBase()), ""),
        "function_count":    len(functions),
        "string_count":      len(strings),
        "import_count":      len(imports),
        "export_count":      len(exports),
        "entry_point_count": len(entry_points),
        "tls_callback_count": len(tls_callbacks),
        "data_symbol_count": len(data_symbols),
        "memory_block_count": len(memory_blocks),
        # >0 means the wall-clock budget ran out before every eligible function
        # was decompiled — those extras are listed as body_skipped stubs. The
        # UI can surface a "partial analysis — raise --timeout to decompile all"
        # hint; kept a number so it fits the metadata's string|number contract.
        "decompile_time_skipped_count": decompile_time_skipped,
    }

    result = {
        "functions":     functions,
        "strings":       strings,
        "imports":       imports,
        "exports":       exports,
        "entry_points":  entry_points,
        "tls_callbacks": tls_callbacks,
        "data_symbols":  data_symbols,
        "memory_blocks": memory_blocks,
        "metadata":      metadata,
    }

    _write(OUT_PATH, result)
    println("[extract] wrote " + OUT_PATH +
            " functions=" + str(len(functions)) +
            " strings=" + str(len(strings)) +
            " imports=" + str(len(imports)) +
            " exports=" + str(len(exports)) +
            " entry_points=" + str(len(entry_points)) +
            " tls=" + str(len(tls_callbacks)) +
            " data=" + str(len(data_symbols)) +
            " blocks=" + str(len(memory_blocks)))

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
