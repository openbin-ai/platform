# -*- coding: utf-8 -*-
# Ghidra headless PRE-script: tune the auto-analyzer options before analysis
# runs. analyzeHeadless calls preScripts AFTER import but BEFORE analysis, so
# any options we set here take effect during the auto-analysis pass.
#
# Why this exists: Ghidra's default ELF analysis is conservative on stripped
# binaries -- it primarily picks up functions named in .dynsym (exports).
# WhatsApp's libs.so (17MB, stripped) yielded 10 functions on defaults.
# The "Function Start Search*" analyzers are off by default for most processor
# specs; turning them on lets Ghidra discover function prologues by signature
# rather than by symbol, which is what we want for stripped natives.
#
# We intentionally do NOT enable "Aggressive Instruction Finder" -- it can
# 10x analysis time on large binaries and the user has bounded patience.
#@category OpenAPK

import traceback

# Analyzers worth enabling for stripped ELF .so files. Names match Ghidra's
# internal option names (see Ghidra/Features/Base/.../AbstractAnalyzer).
# Some are no-ops on certain processors; we silently skip those.
ANALYZERS_TO_ENABLE = [
    "Function Start Search",
    "Function Start Search After Code",
    "Function Start Search After Data",
    "Decompiler Parameter ID",
    "Decompiler Switch Analysis",
    "Demangler GNU",
    "Embedded Media",
    "ELF Scalar Operand References",
    "Reference",
    "Subroutine References",
]

if currentProgram is None:
    println("[preflight] no current program -- nothing to tune")
else:
    try:
        options = currentProgram.getOptions("Analyzers")
        enabled = []
        skipped = []
        for name in ANALYZERS_TO_ENABLE:
            try:
                # Only set if the option exists for this processor / loader --
                # avoids creating ghost options that confuse later runs.
                if options.contains(name):
                    options.setBoolean(name, True)
                    enabled.append(name)
                else:
                    skipped.append(name)
            except:
                skipped.append(name + " (error)")
        println("[preflight] enabled " + str(len(enabled)) + " analyzers: " + ", ".join(enabled))
        if skipped:
            println("[preflight] skipped (not present for this binary): " + ", ".join(skipped))
    except Exception, e:
        println("[preflight] FAILED to tune analyzers: " + str(e))
        println(traceback.format_exc())
        # Don't raise -- a tuning failure shouldn't block analysis from running
        # with whatever defaults Ghidra picked.
