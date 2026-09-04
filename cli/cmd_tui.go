package main

// `openbin tui` (also `openbin --tui`): an interactive wizard for people who
// don't want to memorize flags — most importantly the RAW FIRMWARE crowd, who
// need to pick a processor from a list because Ghidra can't autodetect a
// headerless image. The wizard collects file → architecture → target project
// (new, or add as a sample to an existing multi-sample project) → name, then
// LEAVES the TUI and runs the normal decompile pipeline with its usual
// streaming output (worker logs, heartbeat, post-mortems all unchanged).

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strings"
	"time"

	"github.com/charmbracelet/bubbles/textinput"
	tea "github.com/charmbracelet/bubbletea"
	"github.com/charmbracelet/lipgloss"
	"github.com/spf13/cobra"
)

var tuiCmd = &cobra.Command{
	Use:   "tui [binary]",
	Short: "Interactive decompile wizard (pick the file, arch, and target project)",
	Long: `Opens a terminal UI that walks through a local decompile:

  1. Pick the binary (a list of binaries in the current directory, or type a path).
  2. Pick the architecture — autodetect for ELF/PE/Mach-O, or force a Ghidra
     processor from a list (required for raw firmware images).
  3. Pick the target: a NEW project, or ADD the result as another sample to an
     existing multi-sample project.

The decompile itself then runs with the normal streaming output.`,
	Args: cobra.MaximumNArgs(1),
	RunE: func(cmd *cobra.Command, args []string) error {
		preset := ""
		if len(args) == 1 {
			preset = args[0]
		}
		return runTUIWizard(preset)
	},
}

func init() {
	rootCmd.AddCommand(tuiCmd)
	// `openbin --tui` — same wizard for people who reach for a flag.
	rootCmd.Flags().Bool("tui", false, "open the interactive decompile wizard")
	rootCmd.RunE = func(cmd *cobra.Command, args []string) error {
		if v, _ := cmd.Flags().GetBool("tui"); v {
			return runTUIWizard("")
		}
		return cmd.Help()
	}
}

// tuiResult is what the wizard hands back to the plain-terminal pipeline.
type tuiResult struct {
	confirmed bool
	path      string
	processor string // "" = autodetect
	toExist   bool   // add to an existing project instead of creating one
	projectID string // target project (toExist)
	projName  string // target project display name (toExist, for messages)
	name      string // new-project display name / sample label
}

func runTUIWizard(presetPath string) error {
	cfg := loadConfig()
	// Auth up front — the wizard lists projects and the pipeline uploads.
	if _, err := ensureValidAccessToken(cfg); err != nil {
		return err
	}
	tokenLookup := func() (string, error) { return ensureValidAccessToken(cfg) }

	m := newWizard(cfg, tokenLookup, presetPath)
	p := tea.NewProgram(m, tea.WithAltScreen())
	out, err := p.Run()
	if err != nil {
		return err
	}
	res := out.(*wizard).result
	if !res.confirmed {
		fmt.Println("Cancelled — nothing decompiled.")
		return nil
	}

	// --- back on the plain terminal: run the standard pipeline -------------
	image := envOr("OPENBIN_GHIDRA_IMAGE", ghidraWorkerImage)
	archLabel := "auto"
	if res.processor != "" {
		archLabel = res.processor
	}

	if !res.toExist {
		url, err := decompileOne(cfg, tokenLookup, res.path, res.name, archLabel,
			res.processor, image, workerLimits{}, "", true)
		if err != nil {
			return err
		}
		fmt.Println("Done!", url)
		return nil
	}

	// Add as a sample to an existing multi-sample project.
	filename := filepath.Base(res.path)
	fmt.Println("Hashing...")
	sha, size, err := fileSha256(res.path)
	if err != nil {
		return err
	}
	fmt.Printf("Decompiling %s (%.1f MB, sha256=%s) locally...\n",
		filename, float64(size)/(1024*1024), sha[:12])
	if res.processor != "" {
		fmt.Printf("Forcing Ghidra processor %s\n", res.processor)
	}
	start := time.Now()
	workerJSON, err := runLocalGhidra(res.path, archLabel, res.processor, image, workerLimits{})
	if err != nil {
		return err
	}
	fmt.Printf("Local decompile finished in %s. Uploading into %q...\n",
		roundDuration(time.Since(start)), res.projName)
	label := res.name
	if label == "" {
		label = filename
	}
	if _, err := ingestSampleV2(cfg, tokenLookup, res.projectID, label, filename,
		archLabel, sha, size, workerJSON); err != nil {
		return err
	}
	fmt.Println("Done!", projectWebURL(cfg, projectKindBin, res.projectID))
	return nil
}

// --- the bubbletea wizard ---------------------------------------------------

type wizStage int

const (
	wizFile wizStage = iota
	wizScan          // raw image: firmware arch detection running in the background
	wizArch          // raw image only — confirm the detected arch, or pick by hand
	wizCustomProc
	wizTarget
	wizProjects
	wizName
	wizConfirm
)

var wizProcessorRe = regexp.MustCompile(`^[A-Za-z0-9_.+-]+:[LB]E:[0-9]+:[A-Za-z0-9_.+-]+$`)

var (
	wizAccent = lipgloss.NewStyle().Foreground(lipgloss.Color("135")).Bold(true)
	wizDim    = lipgloss.NewStyle().Foreground(lipgloss.Color("243"))
	wizErr    = lipgloss.NewStyle().Foreground(lipgloss.Color("203"))
	wizOK     = lipgloss.NewStyle().Foreground(lipgloss.Color("78"))
)

// archRow is one selectable row on the architecture screen.
type archRow struct {
	id    string // Ghidra language ID; "" = autodetect; "custom" sentinel
	label string
}

// projRow is one of the caller's BIN projects (for "add to existing").
type projRow struct {
	ID     string `json:"id"`
	Name   string `json:"name"`
	Kind   string `json:"kind"`
	Status string `json:"status"`
}

type projectsMsg struct {
	rows []projRow
	err  error
}

// firmScanMsg carries the raw-image detection result (uImage / embedded ELF /
// opcode census, plus host binwalk output when installed).
type firmScanMsg struct {
	guess   firmGuess
	binwalk string
}

type wizard struct {
	cfg    config
	tokens func() (string, error)

	stage  wizStage
	width  int
	height int
	errMsg string

	// file stage
	fileInput  textinput.Model
	candidates []string // files in cwd (with format tags rendered at view time)
	fileCursor int      // 0 = the text input row; 1.. = candidates
	guess      archGuess

	// arch stage (raw images only — known formats skip it)
	archRows   []archRow
	archCursor int
	procInput  textinput.Model // custom processor entry
	firm       firmGuess       // raw-image detection result
	binwalkOut string          // host binwalk evidence, "" when unavailable

	// target stage
	targetCursor int

	// projects stage
	projects    []projRow
	projCursor  int
	projLoading bool
	projErr     string

	// name stage
	nameInput textinput.Model

	result tuiResult
}

func newWizard(cfg config, tokens func() (string, error), preset string) *wizard {
	fi := textinput.New()
	fi.Placeholder = "path to a binary, e.g. ~/samples/router-fw.bin"
	fi.Prompt = "path ❯ "
	fi.CharLimit = 1000
	fi.SetValue(preset)
	fi.Focus()

	pi := textinput.New()
	pi.Placeholder = "Ghidra language ID, e.g. ARM:LE:32:v7"
	pi.Prompt = "processor ❯ "
	pi.CharLimit = 60

	ni := textinput.New()
	ni.Prompt = "name ❯ "
	ni.CharLimit = 120

	return &wizard{
		cfg:        cfg,
		tokens:     tokens,
		stage:      wizFile,
		fileInput:  fi,
		procInput:  pi,
		nameInput:  ni,
		candidates: listCwdFiles(),
	}
}

// listCwdFiles lists regular non-hidden files in the current directory (any
// type — raw firmware has no magic, so we can't filter by looksLikeBinary the
// way the sweep does), sorted, capped.
func listCwdFiles() []string {
	entries, err := os.ReadDir(".")
	if err != nil {
		return nil
	}
	var out []string
	for _, e := range entries {
		if e.IsDir() || strings.HasPrefix(e.Name(), ".") {
			continue
		}
		if info, err := e.Info(); err != nil || !info.Mode().IsRegular() {
			continue
		}
		out = append(out, e.Name())
		if len(out) >= 100 {
			break
		}
	}
	sort.Strings(out)
	return out
}

func (m *wizard) Init() tea.Cmd { return textinput.Blink }

func (m *wizard) Update(msg tea.Msg) (tea.Model, tea.Cmd) {
	switch msg := msg.(type) {
	case tea.WindowSizeMsg:
		m.width, m.height = msg.Width, msg.Height
		return m, nil
	case projectsMsg:
		m.projLoading = false
		if msg.err != nil {
			m.projErr = msg.err.Error()
			return m, nil
		}
		m.projects = msg.rows
		return m, nil
	case firmScanMsg:
		// Detection succeeded → the detected arch sits preselected on top and
		// one Enter confirms it. Detection failed → the view says so plainly
		// and the user picks from the list / enters a custom ID.
		m.firm = msg.guess
		m.binwalkOut = msg.binwalk
		m.archRows = buildArchRows(m.guess, m.firm)
		m.archCursor = 0
		m.stage = wizArch
		return m, nil
	case tea.KeyMsg:
		if msg.String() == "ctrl+c" {
			m.result.confirmed = false
			return m, tea.Quit
		}
		switch m.stage {
		case wizFile:
			return m.updateFile(msg)
		case wizScan:
			if msg.String() == "esc" {
				m.stage = wizFile
			}
			return m, nil
		case wizArch:
			return m.updateArch(msg)
		case wizCustomProc:
			return m.updateCustomProc(msg)
		case wizTarget:
			return m.updateTarget(msg)
		case wizProjects:
			return m.updateProjects(msg)
		case wizName:
			return m.updateName(msg)
		case wizConfirm:
			return m.updateConfirm(msg)
		}
	}
	return m, nil
}

// --- file stage -------------------------------------------------------------

func (m *wizard) updateFile(msg tea.KeyMsg) (tea.Model, tea.Cmd) {
	switch msg.String() {
	case "esc":
		m.result.confirmed = false
		return m, tea.Quit
	case "up":
		if m.fileCursor > 0 {
			m.fileCursor--
		}
		return m, nil
	case "down":
		if m.fileCursor < len(m.candidates) {
			m.fileCursor++
		}
		return m, nil
	case "enter":
		path := strings.TrimSpace(m.fileInput.Value())
		if m.fileCursor > 0 {
			path = m.candidates[m.fileCursor-1]
		}
		path = expandHomeTUI(strings.Trim(path, `"'`))
		info, err := os.Stat(path)
		if err != nil {
			m.errMsg = err.Error()
			return m, nil
		}
		if info.IsDir() {
			m.errMsg = "that's a directory — for sweeps use `openbin decompile <dir>`; pick a single file here"
			return m, nil
		}
		abs, err := filepath.Abs(path)
		if err == nil {
			path = abs
		}
		m.errMsg = ""
		m.result.path = path
		m.guess = detectArch(path)
		if m.guess.Known() {
			// A real ELF/PE/Mach-O header — Ghidra autodetects this itself,
			// so there is nothing to pick. Straight to the target step.
			m.result.processor = ""
			m.stage = wizTarget
			m.targetCursor = 0
			return m, nil
		}
		// Raw image: run the firmware detectors (uImage header, embedded ELF,
		// opcode census, host binwalk if installed) before bothering the user.
		m.stage = wizScan
		p := path
		return m, func() tea.Msg {
			return firmScanMsg{guess: detectFirmwareArch(p), binwalk: binwalkEvidence(p)}
		}
	}
	// typing = editing the path row
	m.fileCursor = 0
	var cmd tea.Cmd
	m.fileInput, cmd = m.fileInput.Update(msg)
	return m, cmd
}

// buildArchRows assembles the raw-image processor picker. When the firmware
// detectors produced a guess it goes on top, preselected — one Enter accepts
// it; the common list below is the manual override. When they didn't, the
// list IS the flow (the view says so).
func buildArchRows(g archGuess, firm firmGuess) []archRow {
	var rows []archRow
	if firm.Processor != "" {
		why := "detection"
		if len(firm.Evidence) > 0 {
			why = firm.Evidence[0]
		}
		rows = append(rows, archRow{
			id:    firm.Processor,
			label: fmt.Sprintf("Use detected: %s  (%s confidence — %s)", firm.Processor, firm.Confidence, why),
		})
	}
	for _, c := range commonProcessors {
		if c.ID == firm.Processor {
			continue // already the top row
		}
		rows = append(rows, archRow{id: c.ID, label: c.Label + "   " + c.ID})
	}
	rows = append(rows, archRow{id: "custom", label: "Custom… (type any Ghidra language ID)"})
	return rows
}

// --- arch stage -------------------------------------------------------------

func (m *wizard) updateArch(msg tea.KeyMsg) (tea.Model, tea.Cmd) {
	switch msg.String() {
	case "esc":
		m.stage = wizFile
		return m, nil
	case "up", "k":
		if m.archCursor > 0 {
			m.archCursor--
		}
	case "down", "j":
		if m.archCursor < len(m.archRows)-1 {
			m.archCursor++
		}
	case "enter":
		row := m.archRows[m.archCursor]
		if row.id == "custom" {
			m.procInput.SetValue("")
			m.procInput.Focus()
			m.stage = wizCustomProc
			return m, textinput.Blink
		}
		m.result.processor = row.id
		m.stage = wizTarget
		m.targetCursor = 0
		return m, nil
	}
	return m, nil
}

func (m *wizard) updateCustomProc(msg tea.KeyMsg) (tea.Model, tea.Cmd) {
	switch msg.String() {
	case "esc":
		m.stage = wizArch
		return m, nil
	case "enter":
		v := strings.TrimSpace(m.procInput.Value())
		if !wizProcessorRe.MatchString(v) {
			m.errMsg = "not a Ghidra language ID (family:endianness:size:variant, e.g. ARM:LE:32:v7)"
			return m, nil
		}
		m.errMsg = ""
		m.result.processor = v
		m.stage = wizTarget
		m.targetCursor = 0
		return m, nil
	}
	var cmd tea.Cmd
	m.procInput, cmd = m.procInput.Update(msg)
	return m, cmd
}

// --- target stage -----------------------------------------------------------

var wizTargets = []struct{ label, desc string }{
	{"Create a new project", "the result becomes a fresh project in your list"},
	{"Add to an existing project", "upload as another SAMPLE of a project you already have (multi-sample)"},
}

func (m *wizard) updateTarget(msg tea.KeyMsg) (tea.Model, tea.Cmd) {
	switch msg.String() {
	case "esc":
		// Known formats never saw the arch screen — esc returns to the file.
		if m.guess.Known() {
			m.stage = wizFile
		} else {
			m.stage = wizArch
		}
		return m, nil
	case "up", "k":
		if m.targetCursor > 0 {
			m.targetCursor--
		}
	case "down", "j":
		if m.targetCursor < len(wizTargets)-1 {
			m.targetCursor++
		}
	case "enter":
		if m.targetCursor == 0 {
			m.result.toExist = false
			m.nameInput.SetValue(filepath.Base(m.result.path))
			m.nameInput.Focus()
			m.stage = wizName
			return m, textinput.Blink
		}
		m.result.toExist = true
		m.stage = wizProjects
		m.projLoading = true
		m.projErr = ""
		return m, m.fetchProjects()
	}
	return m, nil
}

// fetchProjects loads the caller's BIN projects off the UI thread.
func (m *wizard) fetchProjects() tea.Cmd {
	cfg, tokens := m.cfg, m.tokens
	return func() tea.Msg {
		token, err := tokens()
		if err != nil {
			return projectsMsg{err: err}
		}
		body, err := getJSONRetry(cfg.apiBase+"/api/projects", token)
		if err != nil {
			return projectsMsg{err: err}
		}
		var all []projRow
		if err := json.Unmarshal(body, &all); err != nil {
			return projectsMsg{err: err}
		}
		var bins []projRow
		for _, p := range all {
			if p.Kind == "BIN" {
				bins = append(bins, p)
			}
		}
		return projectsMsg{rows: bins}
	}
}

func (m *wizard) updateProjects(msg tea.KeyMsg) (tea.Model, tea.Cmd) {
	switch msg.String() {
	case "esc":
		m.stage = wizTarget
		return m, nil
	case "up", "k":
		if m.projCursor > 0 {
			m.projCursor--
		}
	case "down", "j":
		if m.projCursor < len(m.projects)-1 {
			m.projCursor++
		}
	case "enter":
		if m.projLoading || len(m.projects) == 0 {
			return m, nil
		}
		p := m.projects[m.projCursor]
		m.result.projectID = p.ID
		m.result.projName = p.Name
		m.nameInput.SetValue(filepath.Base(m.result.path))
		m.nameInput.Focus()
		m.stage = wizName
		return m, textinput.Blink
	}
	return m, nil
}

// --- name + confirm ---------------------------------------------------------

func (m *wizard) updateName(msg tea.KeyMsg) (tea.Model, tea.Cmd) {
	switch msg.String() {
	case "esc":
		if m.result.toExist {
			m.stage = wizProjects
		} else {
			m.stage = wizTarget
		}
		return m, nil
	case "enter":
		m.result.name = strings.TrimSpace(m.nameInput.Value())
		if m.result.name == "" {
			m.result.name = filepath.Base(m.result.path)
		}
		m.stage = wizConfirm
		return m, nil
	}
	var cmd tea.Cmd
	m.nameInput, cmd = m.nameInput.Update(msg)
	return m, cmd
}

func (m *wizard) updateConfirm(msg tea.KeyMsg) (tea.Model, tea.Cmd) {
	switch msg.String() {
	case "esc":
		m.stage = wizName
		return m, nil
	case "enter", "y":
		m.result.confirmed = true
		return m, tea.Quit
	case "n", "q":
		m.result.confirmed = false
		return m, tea.Quit
	}
	return m, nil
}

// --- views -------------------------------------------------------------------

func (m *wizard) View() string {
	var b strings.Builder
	b.WriteString(wizAccent.Render("openbin · decompile wizard") + "\n")
	b.WriteString(wizDim.Render(strings.Repeat("─", maxInt(20, m.width))) + "\n\n")
	switch m.stage {
	case wizFile:
		m.viewFile(&b)
	case wizScan:
		b.WriteString("Raw image — no executable header. Scanning for architecture evidence…\n\n")
		b.WriteString(wizDim.Render("(uImage header · embedded ELF objects · opcode signatures · binwalk if installed)") + "\n\n")
		b.WriteString(wizDim.Render("esc cancel") + "\n")
	case wizArch:
		m.viewArch(&b)
	case wizCustomProc:
		b.WriteString("Enter a Ghidra language ID (see Ghidra's processor list):\n\n")
		b.WriteString(m.procInput.View() + "\n\n")
		b.WriteString(wizDim.Render("enter continue · esc back") + "\n")
	case wizTarget:
		b.WriteString("Where should the result go?\n\n")
		for i, t := range wizTargets {
			cursor, style := "  ", wizDim
			if i == m.targetCursor {
				cursor, style = wizAccent.Render("▸ "), wizAccent
			}
			b.WriteString(cursor + style.Render(t.label) + wizDim.Render("  — "+t.desc) + "\n")
		}
		b.WriteString("\n" + wizDim.Render("↑/↓ move · enter select · esc back") + "\n")
	case wizProjects:
		m.viewProjects(&b)
	case wizName:
		label := "Project name:"
		if m.result.toExist {
			label = "Sample label (how this binary is listed inside " + m.result.projName + "):"
		}
		b.WriteString(label + "\n\n")
		b.WriteString(m.nameInput.View() + "\n\n")
		b.WriteString(wizDim.Render("enter continue · esc back") + "\n")
	case wizConfirm:
		m.viewConfirm(&b)
	}
	if m.errMsg != "" {
		b.WriteString("\n" + wizErr.Render(m.errMsg) + "\n")
	}
	return b.String()
}

func (m *wizard) viewFile(b *strings.Builder) {
	b.WriteString("Which binary? Type a path, or pick one from this directory:\n\n")
	cursor := "  "
	if m.fileCursor == 0 {
		cursor = wizAccent.Render("▸ ")
	}
	b.WriteString(cursor + m.fileInput.View() + "\n")
	show := m.candidates
	maxShow := maxInt(5, m.height-12)
	if len(show) > maxShow {
		show = show[:maxShow]
	}
	for i, c := range show {
		cur, style := "  ", wizDim
		if m.fileCursor == i+1 {
			cur, style = wizAccent.Render("▸ "), wizAccent
		}
		tag := detectArch(c).Format
		b.WriteString(cur + style.Render(c) + wizDim.Render("  ["+tag+"]") + "\n")
	}
	if len(m.candidates) > len(show) {
		b.WriteString(wizDim.Render(fmt.Sprintf("  … %d more (type the path instead)", len(m.candidates)-len(show))) + "\n")
	}
	b.WriteString("\n" + wizDim.Render("↑/↓ move · enter select · esc quit") + "\n")
}

func (m *wizard) viewArch(b *strings.Builder) {
	b.WriteString("Architecture for " + wizAccent.Render(filepath.Base(m.result.path)) + wizDim.Render("  (raw image — Ghidra can't autodetect it)") + "\n")
	if m.firm.Processor != "" {
		b.WriteString(wizOK.Render("✓ Detected "+m.firm.Processor+" ("+m.firm.Confidence+" confidence)") + "\n")
		for i, ev := range m.firm.Evidence {
			if i >= 3 {
				break
			}
			b.WriteString(wizDim.Render("  · "+ev) + "\n")
		}
		b.WriteString("\n")
	} else {
		b.WriteString(wizErr.Render("✗ Sorry — couldn't identify the architecture automatically.") + "\n")
		b.WriteString(wizDim.Render("  Tried: uImage header · embedded ELF objects · opcode signatures"+binwalkTriedNote(m.binwalkOut)+" — no luck.") + "\n")
		b.WriteString(wizDim.Render("  You'll have to figure this one out (vendor/SoC docs, binwalk -A, strings, or ask BINNY) and pick below.") + "\n\n")
	}
	if m.binwalkOut != "" {
		b.WriteString(wizDim.Render("binwalk says:") + "\n")
		for _, ln := range strings.Split(m.binwalkOut, "\n") {
			b.WriteString(wizDim.Render("  "+truncateTUI(ln, maxInt(20, m.width-4))) + "\n")
		}
		b.WriteString("\n")
	}
	maxShow := maxInt(6, m.height-14-lineCountTUI(m.binwalkOut))
	start := 0
	if m.archCursor >= maxShow {
		start = m.archCursor - maxShow + 1
	}
	end := minInt(len(m.archRows), start+maxShow)
	if start > 0 {
		b.WriteString(wizDim.Render(fmt.Sprintf("  ↑ %d more", start)) + "\n")
	}
	for i := start; i < end; i++ {
		cur, style := "  ", wizDim
		if i == m.archCursor {
			cur, style = wizAccent.Render("▸ "), wizAccent
		}
		b.WriteString(cur + style.Render(m.archRows[i].label) + "\n")
	}
	if end < len(m.archRows) {
		b.WriteString(wizDim.Render(fmt.Sprintf("  ↓ %d more", len(m.archRows)-end)) + "\n")
	}
	b.WriteString("\n" + wizDim.Render("↑/↓ move · enter select · esc back") + "\n")
}

func (m *wizard) viewProjects(b *strings.Builder) {
	b.WriteString("Add this sample to which project?\n\n")
	switch {
	case m.projLoading:
		b.WriteString(wizDim.Render("Loading your projects…") + "\n")
	case m.projErr != "":
		b.WriteString(wizErr.Render("Couldn't load projects: "+m.projErr) + "\n")
		b.WriteString(wizDim.Render("esc to go back") + "\n")
	case len(m.projects) == 0:
		b.WriteString(wizDim.Render("No BIN projects yet — go back and create a new one.") + "\n")
		b.WriteString(wizDim.Render("esc back") + "\n")
	default:
		maxShow := maxInt(6, m.height-10)
		start := 0
		if m.projCursor >= maxShow {
			start = m.projCursor - maxShow + 1
		}
		end := minInt(len(m.projects), start+maxShow)
		for i := start; i < end; i++ {
			p := m.projects[i]
			cur, style := "  ", wizDim
			if i == m.projCursor {
				cur, style = wizAccent.Render("▸ "), wizAccent
			}
			b.WriteString(cur + style.Render(truncateTUI(p.Name, 48)) + wizDim.Render("  "+p.Status) + "\n")
		}
		if end < len(m.projects) {
			b.WriteString(wizDim.Render(fmt.Sprintf("  ↓ %d more", len(m.projects)-end)) + "\n")
		}
		b.WriteString("\n" + wizDim.Render("↑/↓ move · enter select · esc back") + "\n")
	}
}

func (m *wizard) viewConfirm(b *strings.Builder) {
	b.WriteString("Ready:\n\n")
	b.WriteString("  binary    " + wizAccent.Render(m.result.path) + "\n")
	arch := "autodetect (" + m.guess.Detail + ")"
	if m.result.processor != "" {
		arch = m.result.processor + " (forced)"
	}
	b.WriteString("  arch      " + arch + "\n")
	if m.result.toExist {
		b.WriteString("  target    add sample to " + wizAccent.Render(m.result.projName) + "\n")
		b.WriteString("  label     " + m.result.name + "\n")
	} else {
		b.WriteString("  target    new project\n")
		b.WriteString("  name      " + m.result.name + "\n")
	}
	b.WriteString("\n" + wizOK.Render("enter start decompiling") + wizDim.Render(" · esc back · n cancel") + "\n")
}

// --- small helpers -----------------------------------------------------------

func expandHomeTUI(p string) string {
	if p == "~" || strings.HasPrefix(p, "~/") {
		if home, err := os.UserHomeDir(); err == nil {
			return filepath.Join(home, strings.TrimPrefix(p, "~"))
		}
	}
	return p
}

// binwalkTriedNote renders " · binwalk" for the tried-list only when binwalk
// actually ran (produced output).
func binwalkTriedNote(binwalkOut string) string {
	if binwalkOut != "" {
		return " · binwalk"
	}
	return ""
}

func lineCountTUI(s string) int {
	if s == "" {
		return 0
	}
	return strings.Count(s, "\n") + 3 // + the "binwalk says:" chrome
}

func truncateTUI(s string, n int) string {
	if len(s) <= n {
		return s
	}
	return s[:n-1] + "…"
}

func maxInt(a, b int) int {
	if a > b {
		return a
	}
	return b
}

func minInt(a, b int) int {
	if a < b {
		return a
	}
	return b
}
