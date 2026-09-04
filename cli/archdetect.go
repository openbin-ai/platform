package main

// Header-based arch detection for the TUI's processor picker. Mirrors
// binny/internal/archdetect (separate Go module — kept in sync by hand, same
// as the duplicated frontend components): ELF/PE/Mach-O headers map to a
// Ghidra language ID; anything headerless is "raw" and MUST have a processor
// forced for Ghidra to import it.

import (
	"debug/elf"
	"debug/macho"
	"debug/pe"
	"fmt"
)

type archGuess struct {
	Format    string // "elf" | "pe" | "macho" | "raw"
	Processor string // Ghidra language ID, "" when unknown
	Detail    string // human-readable summary
}

func (g archGuess) Known() bool { return g.Format != "raw" }

// processorChoice is one row in the TUI's arch list.
type processorChoice struct {
	ID    string // Ghidra language ID ("" = autodetect)
	Label string
}

// commonProcessors is the picker list for raw firmware, most common first.
var commonProcessors = []processorChoice{
	{"ARM:LE:32:v7", "ARM 32-bit LE (v7) — most Linux/IoT firmware"},
	{"AARCH64:LE:64:v8A", "ARM64 (AArch64 v8-A)"},
	{"MIPS:BE:32:default", "MIPS 32-bit BE — routers/cameras"},
	{"MIPS:LE:32:default", "MIPS 32-bit LE (mipsel)"},
	{"x86:LE:64:default", "x86-64"},
	{"x86:LE:32:default", "x86 32-bit"},
	{"ARM:BE:32:v7", "ARM 32-bit BE (v7)"},
	{"PowerPC:BE:32:default", "PowerPC 32-bit BE"},
	{"RISCV:LE:64:RV64GC", "RISC-V 64-bit (RV64GC)"},
	{"RISCV:LE:32:RV32GC", "RISC-V 32-bit (RV32GC)"},
	{"Xtensa:LE:32:default", "Xtensa LE — ESP8266/ESP32"},
	{"SuperH4:LE:32:default", "SuperH SH-4 LE"},
	{"sparc:BE:32:default", "SPARC 32-bit BE"},
	{"AVR8:LE:16:extended", "AVR8 (extended)"},
}

// detectArch inspects the file's header and returns the best guess.
func detectArch(path string) archGuess {
	if g, ok := detectELFArch(path); ok {
		return g
	}
	if g, ok := detectPEArch(path); ok {
		return g
	}
	if g, ok := detectMachOArch(path); ok {
		return g
	}
	return archGuess{Format: "raw", Detail: "no ELF/PE/Mach-O header — raw image (firmware?); Ghidra can't autodetect, pick a processor"}
}

func detectELFArch(path string) (archGuess, bool) {
	f, err := elf.Open(path)
	if err != nil {
		return archGuess{}, false
	}
	defer f.Close()
	end, sz := "LE", "32"
	if f.Data != elf.ELFDATA2LSB {
		end = "BE"
	}
	if f.Class == elf.ELFCLASS64 {
		sz = "64"
	}
	proc := ""
	switch f.Machine {
	case elf.EM_X86_64:
		proc = "x86:LE:64:default"
	case elf.EM_386:
		proc = "x86:LE:32:default"
	case elf.EM_AARCH64:
		proc = "AARCH64:" + end + ":64:v8A"
	case elf.EM_ARM:
		proc = "ARM:" + end + ":32:v7"
	case elf.EM_MIPS:
		proc = "MIPS:" + end + ":" + sz + ":default"
	case elf.EM_PPC:
		proc = "PowerPC:" + end + ":32:default"
	case elf.EM_PPC64:
		proc = "PowerPC:" + end + ":64:default"
	case elf.EM_RISCV:
		if sz == "64" {
			proc = "RISCV:LE:64:RV64GC"
		} else {
			proc = "RISCV:LE:32:RV32GC"
		}
	case elf.EM_SPARC, elf.EM_SPARCV9:
		proc = "sparc:BE:" + sz + ":default"
	case elf.EM_SH:
		proc = "SuperH4:" + end + ":32:default"
	}
	return archGuess{
		Format:    "elf",
		Processor: proc,
		Detail:    fmt.Sprintf("ELF %s-bit %s, machine=%s", sz, end, f.Machine),
	}, true
}

func detectPEArch(path string) (archGuess, bool) {
	f, err := pe.Open(path)
	if err != nil {
		return archGuess{}, false
	}
	defer f.Close()
	proc, name := "", fmt.Sprintf("0x%x", f.Machine)
	switch f.Machine {
	case pe.IMAGE_FILE_MACHINE_AMD64:
		proc, name = "x86:LE:64:default", "amd64"
	case pe.IMAGE_FILE_MACHINE_I386:
		proc, name = "x86:LE:32:default", "i386"
	case pe.IMAGE_FILE_MACHINE_ARM64:
		proc, name = "AARCH64:LE:64:v8A", "arm64"
	case pe.IMAGE_FILE_MACHINE_ARMNT:
		proc, name = "ARM:LE:32:v7", "armnt"
	}
	return archGuess{Format: "pe", Processor: proc, Detail: "PE, machine=" + name}, true
}

func detectMachOArch(path string) (archGuess, bool) {
	proc, detail := "", ""
	if f, err := macho.Open(path); err == nil {
		defer f.Close()
		proc, detail = machoCPUArch(f.Cpu)
	} else if ff, err := macho.OpenFat(path); err == nil {
		defer ff.Close()
		if len(ff.Arches) > 0 {
			proc, detail = machoCPUArch(ff.Arches[0].Cpu)
			detail += fmt.Sprintf(" (fat, %d arches — first slice used)", len(ff.Arches))
		}
	} else {
		return archGuess{}, false
	}
	return archGuess{Format: "macho", Processor: proc, Detail: "Mach-O, " + detail}, true
}

func machoCPUArch(c macho.Cpu) (string, string) {
	switch c {
	case macho.CpuAmd64:
		return "x86:LE:64:default", "x86_64"
	case macho.Cpu386:
		return "x86:LE:32:default", "i386"
	case macho.CpuArm64:
		return "AARCH64:LE:64:v8A", "arm64"
	case macho.CpuArm:
		return "ARM:LE:32:v7", "arm"
	default:
		return "", fmt.Sprintf("cpu=0x%x", uint32(c))
	}
}
