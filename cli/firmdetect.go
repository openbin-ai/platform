package main

// Firmware architecture detection for RAW images (no ELF/PE/Mach-O header).
// This is the "binwalk step" of the decompile flow, built in so it works with
// zero host dependencies. Three detectors, strongest first:
//
//  1. uImage (U-Boot) header — the header literally declares the CPU (ih_arch).
//  2. Embedded ELF objects — firmware blobs almost always carry ELF kernels /
//     busybox / libraries; their e_machine is the image's arch.
//  3. Opcode signatures — exact 4-byte return/prologue sequences (`ret`,
//     `jr ra`, `blr`, `bx lr`, x86 frame setup) whose random-collision rate is
//     ~len/2^32, i.e. effectively zero false positives.
//
// If the host has binwalk installed we also run it for extra human-readable
// evidence, but nothing depends on it. When every detector comes up empty the
// caller tells the user plainly: sorry, you'll have to identify it yourself.

import (
	"bytes"
	"context"
	"encoding/binary"
	"fmt"
	"io"
	"os"
	"os/exec"
	"strings"
	"time"
)

// firmScanCap bounds how much of the image we read. 32MB covers the header +
// enough code for the opcode census on even large images.
const firmScanCap = 32 << 20

type firmGuess struct {
	Processor  string   // Ghidra language ID, "" = nothing detected
	Confidence string   // "high" (declared/embedded metadata) | "medium" (opcode census)
	Evidence   []string // human-readable, strongest first
}

// detectFirmwareArch inspects a raw image and returns the best guess. A zero
// Processor means every detector failed and the user must pick by hand.
func detectFirmwareArch(path string) firmGuess {
	buf, err := readCapped(path, firmScanCap)
	if err != nil || len(buf) < 8 {
		return firmGuess{}
	}
	var g firmGuess

	if p, ev := detectUImage(buf); p != "" {
		g.Processor, g.Confidence = p, "high"
		g.Evidence = append(g.Evidence, ev)
	}
	if p, ev := detectEmbeddedELF(buf); p != "" {
		if g.Processor == "" {
			g.Processor, g.Confidence = p, "high"
		}
		g.Evidence = append(g.Evidence, ev)
		// An embedded ELF that contradicts the uImage header is worth seeing.
		if g.Processor != "" && p != g.Processor {
			g.Evidence = append(g.Evidence,
				fmt.Sprintf("note: embedded ELF arch (%s) differs from the first detector (%s)", p, g.Processor))
		}
	}
	if op, ev := detectOpcodes(buf); op != "" {
		if g.Processor == "" {
			g.Processor, g.Confidence = op, "medium"
		}
		g.Evidence = append(g.Evidence, ev)
	}
	return g
}

func readCapped(path string, cap int) ([]byte, error) {
	f, err := os.Open(path)
	if err != nil {
		return nil, err
	}
	defer f.Close()
	buf := make([]byte, cap)
	n, err := io.ReadFull(f, buf)
	if err != nil && err != io.ErrUnexpectedEOF && err != io.EOF {
		return nil, err
	}
	return buf[:n], nil
}

// --- detector 1: uImage (U-Boot legacy image) header ------------------------

// uImage header: ih_magic(4) ih_hcrc(4) ih_time(4) ih_size(4) ih_load(4)
// ih_ep(4) ih_dcrc(4) ih_os(1) ih_arch(1) ih_type(1) ih_comp(1) ih_name(32).
// ih_arch values from U-Boot's image.h.
var uimageMagic = []byte{0x27, 0x05, 0x19, 0x56}

var uimageArch = map[byte]struct{ proc, name string }{
	2:  {"ARM:LE:32:v7", "ARM"},
	3:  {"x86:LE:32:default", "x86"},
	5:  {"MIPS:BE:32:default", "MIPS"}, // endianness not declared; opcode census refines
	6:  {"MIPS:BE:64:default", "MIPS64"},
	7:  {"PowerPC:BE:32:default", "PowerPC"},
	9:  {"SuperH4:LE:32:default", "SuperH"},
	10: {"sparc:BE:32:default", "SPARC"},
	22: {"AARCH64:LE:64:v8A", "ARM64"},
	24: {"x86:LE:64:default", "x86_64"},
	25: {"Xtensa:LE:32:default", "Xtensa"},
	26: {"RISCV:LE:32:RV32GC", "RISC-V"},
}

func detectUImage(buf []byte) (proc, evidence string) {
	// Header at offset 0 is the common case; a wrapped image (TRX etc.) puts
	// it deeper — take the first plausible occurrence.
	for off := 0; ; {
		i := bytes.Index(buf[off:], uimageMagic)
		if i < 0 {
			return "", ""
		}
		at := off + i
		if at+64 > len(buf) {
			return "", ""
		}
		archByte := buf[at+29]
		size := binary.BigEndian.Uint32(buf[at+12 : at+16])
		// Sanity: declared payload size must be non-trivial and not absurd,
		// otherwise this is just the 4 magic bytes occurring in data.
		if a, ok := uimageArch[archByte]; ok && size > 1024 && size < 1<<30 {
			p := a.proc
			// uImage doesn't declare MIPS endianness — let the opcode census vote.
			if archByte == 5 || archByte == 6 {
				if op, _ := detectOpcodes(buf); strings.HasPrefix(op, "MIPS:LE") {
					p = strings.Replace(p, ":BE:", ":LE:", 1)
				}
			}
			return p, fmt.Sprintf("uImage (U-Boot) header at offset 0x%x declares %s", at, a.name)
		}
		off = at + 4
	}
}

// --- detector 2: embedded ELF objects ---------------------------------------

// elfMachineProc maps (e_machine, 64-bit, little-endian) to a Ghidra language
// ID. Numeric constants so this works on ELF fragments found mid-image.
func elfMachineProc(machine uint16, is64, le bool) string {
	end, sz := "BE", "32"
	if le {
		end = "LE"
	}
	if is64 {
		sz = "64"
	}
	switch machine {
	case 62: // EM_X86_64
		return "x86:LE:64:default"
	case 3: // EM_386
		return "x86:LE:32:default"
	case 183: // EM_AARCH64
		return "AARCH64:" + end + ":64:v8A"
	case 40: // EM_ARM
		return "ARM:" + end + ":32:v7"
	case 8: // EM_MIPS
		return "MIPS:" + end + ":" + sz + ":default"
	case 20: // EM_PPC
		return "PowerPC:" + end + ":32:default"
	case 21: // EM_PPC64
		return "PowerPC:" + end + ":64:default"
	case 243: // EM_RISCV
		if is64 {
			return "RISCV:LE:64:RV64GC"
		}
		return "RISCV:LE:32:RV32GC"
	case 2, 18, 43: // EM_SPARC / 32PLUS / V9
		return "sparc:BE:" + sz + ":default"
	case 42: // EM_SH
		return "SuperH4:" + end + ":32:default"
	case 94: // EM_XTENSA
		return "Xtensa:" + end + ":32:default"
	}
	return ""
}

func detectEmbeddedELF(buf []byte) (proc, evidence string) {
	votes := map[string]int{}
	total := 0
	for off := 0; ; {
		i := bytes.Index(buf[off:], []byte("\x7fELF"))
		if i < 0 {
			break
		}
		at := off + i
		off = at + 4
		if at+20 > len(buf) {
			break
		}
		class, data, ver := buf[at+4], buf[at+5], buf[at+6]
		if (class != 1 && class != 2) || (data != 1 && data != 2) || ver != 1 {
			continue // magic bytes in data, not a real header
		}
		le := data == 1
		var machine uint16
		if le {
			machine = binary.LittleEndian.Uint16(buf[at+18 : at+20])
		} else {
			machine = binary.BigEndian.Uint16(buf[at+18 : at+20])
		}
		if p := elfMachineProc(machine, class == 2, le); p != "" {
			votes[p]++
			total++
		}
		if total >= 200 {
			break // plenty of signal
		}
	}
	if total == 0 {
		return "", ""
	}
	best, bestN := "", 0
	for p, n := range votes {
		if n > bestN {
			best, bestN = p, n
		}
	}
	// Require a clear majority — a blob with a 50/50 arch split (multi-arch
	// update bundle) shouldn't silently pick one.
	if bestN*4 < total*3 {
		return "", fmt.Sprintf("%d embedded ELF objects but mixed architectures (%v) — no clear majority", total, votes)
	}
	return best, fmt.Sprintf("%d embedded ELF object(s), %d/%d agree on %s", total, bestN, total, best)
}

// --- detector 3: opcode census ----------------------------------------------

// Exact 4-byte instruction signatures. Random 4-byte collision odds over a
// 32MB scan are ~0.008 expected hits per signature, so a threshold of 10
// is effectively noise-free.
var opcodeSigs = []struct {
	proc  string
	label string
	sig   []byte
}{
	{"AARCH64:LE:64:v8A", "ARM64 `ret`", []byte{0xC0, 0x03, 0x5F, 0xD6}},
	{"ARM:LE:32:v7", "ARM LE `bx lr`", []byte{0x1E, 0xFF, 0x2F, 0xE1}},
	{"ARM:BE:32:v7", "ARM BE `bx lr`", []byte{0xE1, 0x2F, 0xFF, 0x1E}},
	{"MIPS:BE:32:default", "MIPS BE `jr ra`", []byte{0x03, 0xE0, 0x00, 0x08}},
	{"MIPS:LE:32:default", "MIPS LE `jr ra`", []byte{0x08, 0x00, 0xE0, 0x03}},
	{"PowerPC:BE:32:default", "PowerPC `blr`", []byte{0x4E, 0x80, 0x00, 0x20}},
	{"x86:LE:64:default", "x86-64 prologue", []byte{0x55, 0x48, 0x89, 0xE5}},
}

func detectOpcodes(buf []byte) (proc, evidence string) {
	const minHits = 10
	type cand struct {
		proc, label string
		n           int
	}
	var cands []cand
	for _, s := range opcodeSigs {
		cands = append(cands, cand{s.proc, s.label, bytes.Count(buf, s.sig)})
	}
	// x86 32-bit prologue is only 3 bytes (55 89 E5) — slightly noisier, but
	// the 2x-margin rule below keeps it honest against real signals.
	cands = append(cands, cand{"x86:LE:32:default", "x86 prologue (55 89 E5)",
		bytes.Count(buf, []byte{0x55, 0x89, 0xE5})})

	best, second := cand{}, cand{}
	for _, c := range cands {
		switch {
		case c.n > best.n:
			second = best
			best = c
		case c.n > second.n:
			second = c
		}
	}
	// A winner must clear the noise floor AND clearly beat the runner-up —
	// a near-tie means mixed content and no trustworthy vote.
	if best.n < minHits || best.n < 2*second.n {
		return "", ""
	}
	return best.proc, fmt.Sprintf("opcode census: %d× %s (next-best signature %d×)", best.n, best.label, second.n)
}

// --- optional host binwalk evidence -----------------------------------------

// binwalkEvidence runs host binwalk when installed (purely additive evidence —
// nothing depends on it). Returns "" when binwalk is missing or fails.
func binwalkEvidence(path string) string {
	if _, err := exec.LookPath("binwalk"); err != nil {
		return ""
	}
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	out, err := exec.CommandContext(ctx, "binwalk", path).Output()
	if err != nil && len(out) == 0 {
		return ""
	}
	lines := strings.Split(strings.TrimSpace(string(out)), "\n")
	if len(lines) > 14 {
		lines = append(lines[:14], "…")
	}
	return strings.Join(lines, "\n")
}

// resolveRawProcessor is the NON-INTERACTIVE detection step (`openbin
// decompile` on a raw image with no --processor): adopt a detection loudly,
// or fail fast — before the Ghidra container even starts — with the honest
// "you'll have to figure it out" message. The TUI runs the same detectors but
// lets the user confirm interactively.
func resolveRawProcessor(path string) (string, error) {
	fmt.Fprintln(os.Stderr, "Raw image (no ELF/PE/Mach-O header) — scanning for architecture evidence...")
	g := detectFirmwareArch(path)
	if g.Processor != "" {
		fmt.Fprintf(os.Stderr, "Detected %s (%s confidence):\n", g.Processor, g.Confidence)
		for _, ev := range g.Evidence {
			fmt.Fprintln(os.Stderr, "  · "+ev)
		}
		if g.Confidence != "high" {
			fmt.Fprintln(os.Stderr, "Heuristic guess — if the decompiled output looks like garbage, re-run with an explicit --processor.")
		}
		return g.Processor, nil
	}
	if bw := binwalkEvidence(path); bw != "" {
		fmt.Fprintln(os.Stderr, "binwalk says:\n"+bw)
	}
	return "", fmt.Errorf("%s", firmFailureMessage(path))
}

// firmFailureMessage is the honest dead-end message: every detector failed,
// the user has to identify the arch themselves.
func firmFailureMessage(path string) string {
	var b strings.Builder
	b.WriteString("Sorry — couldn't identify this image's architecture automatically.\n")
	b.WriteString("Tried: uImage header, embedded ELF objects, opcode signatures")
	if _, err := exec.LookPath("binwalk"); err == nil {
		b.WriteString(", binwalk")
	}
	b.WriteString(" — no luck.\n\n")
	b.WriteString("You'll have to figure this one out yourself, then re-run with --processor:\n")
	b.WriteString(fmt.Sprintf("  openbin decompile --processor ARM:LE:32:v7 %s\n\n", path))
	b.WriteString("Ways to identify it: the device's vendor/SoC datasheet, `binwalk -A` (opcode\n")
	b.WriteString("scan), `strings` output mentioning a CPU, or attach it to BINNY (/sample) and\n")
	b.WriteString("ask — it has binwalk and byte-level heuristics in its sandbox.\n")
	b.WriteString("Common candidates: ARM:LE:32:v7 · AARCH64:LE:64:v8A · MIPS:BE:32:default ·\n")
	b.WriteString("MIPS:LE:32:default · x86:LE:32:default · PowerPC:BE:32:default · Xtensa:LE:32:default")
	return b.String()
}
