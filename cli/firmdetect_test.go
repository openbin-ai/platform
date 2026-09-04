package main

import (
	"bytes"
	"encoding/binary"
	"os"
	"path/filepath"
	"testing"
)

// deterministic filler that never forms our opcode signatures (avoids flaky
// random collisions): a repeating counter is fine because every signature
// needs specific non-sequential byte patterns.
func filler(n int) []byte {
	b := make([]byte, n)
	for i := range b {
		b[i] = byte(i * 7)
	}
	return b
}

func writeTmp(t *testing.T, data []byte) string {
	t.Helper()
	p := filepath.Join(t.TempDir(), "fw.bin")
	if err := os.WriteFile(p, data, 0o644); err != nil {
		t.Fatal(err)
	}
	return p
}

func TestDetectUImageHeader(t *testing.T) {
	buf := make([]byte, 4096)
	copy(buf, uimageMagic)
	binary.BigEndian.PutUint32(buf[12:16], 1<<20) // sane ih_size
	buf[29] = 2                                   // ih_arch = ARM
	g := detectFirmwareArch(writeTmp(t, buf))
	if g.Processor != "ARM:LE:32:v7" || g.Confidence != "high" {
		t.Fatalf("got %+v", g)
	}
}

func TestDetectUImageMIPSEndianRefine(t *testing.T) {
	buf := filler(64 << 10)
	copy(buf, uimageMagic)
	binary.BigEndian.PutUint32(buf[12:16], 1<<20)
	buf[29] = 5 // ih_arch = MIPS (endianness undeclared)
	// Scatter LE `jr ra` so the census votes little-endian.
	sig := []byte{0x08, 0x00, 0xE0, 0x03}
	for i := 0; i < 40; i++ {
		copy(buf[1024+i*512:], sig)
	}
	g := detectFirmwareArch(writeTmp(t, buf))
	if g.Processor != "MIPS:LE:32:default" {
		t.Fatalf("got %+v", g)
	}
}

func TestDetectEmbeddedELF(t *testing.T) {
	buf := filler(32 << 10)
	elf := make([]byte, 24)
	copy(elf, "\x7fELF")
	elf[4], elf[5], elf[6] = 1, 1, 1              // 32-bit, LE, v1
	binary.LittleEndian.PutUint16(elf[18:20], 40) // EM_ARM
	copy(buf[5000:], elf)
	copy(buf[9000:], elf)
	g := detectFirmwareArch(writeTmp(t, buf))
	if g.Processor != "ARM:LE:32:v7" || g.Confidence != "high" {
		t.Fatalf("got %+v", g)
	}
}

func TestDetectEmbeddedELFMixedNoMajority(t *testing.T) {
	buf := filler(32 << 10)
	mk := func(machine uint16) []byte {
		e := make([]byte, 24)
		copy(e, "\x7fELF")
		e[4], e[5], e[6] = 1, 1, 1
		binary.LittleEndian.PutUint16(e[18:20], machine)
		return e
	}
	copy(buf[4000:], mk(40)) // ARM
	copy(buf[8000:], mk(8))  // MIPS
	g := detectFirmwareArch(writeTmp(t, buf))
	// 50/50 split → ELF detector abstains; nothing else present → no guess.
	if g.Processor != "" {
		t.Fatalf("expected abstain on mixed ELF archs, got %+v", g)
	}
}

func TestDetectOpcodeCensusARM64(t *testing.T) {
	buf := filler(64 << 10)
	ret := []byte{0xC0, 0x03, 0x5F, 0xD6}
	for i := 0; i < 30; i++ {
		copy(buf[2048+i*512:], ret)
	}
	g := detectFirmwareArch(writeTmp(t, buf))
	if g.Processor != "AARCH64:LE:64:v8A" || g.Confidence != "medium" {
		t.Fatalf("got %+v", g)
	}
}

func TestDetectNothing(t *testing.T) {
	g := detectFirmwareArch(writeTmp(t, filler(64<<10)))
	if g.Processor != "" {
		t.Fatalf("expected no guess on featureless data, got %+v", g)
	}
	if !bytes.Contains([]byte(firmFailureMessage("fw.bin")), []byte("figure this one out")) {
		t.Fatal("failure message must tell the user plainly")
	}
}
