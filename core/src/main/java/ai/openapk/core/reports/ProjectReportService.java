package ai.openapk.core.reports;

import ai.openapk.core.analysis.AnalysisMode;
import ai.openapk.core.analysis.dto.AnalysisResponse;
import ai.openapk.core.auth.User;
import ai.openapk.core.projects.Project;
import ai.openapk.core.projects.ProjectAccessGuard;
import ai.openapk.core.projects.ProjectKind;
import ai.openapk.core.projects.ProjectRepository;
import ai.openapk.core.projects.WorkflowStatus;
import ai.openapk.core.projects.storage.ProjectStorage;
import ai.openapk.core.reports.dto.CommunityPublishRequest;
import ai.openapk.core.reports.dto.PopulateRequest;
import ai.openapk.core.reports.dto.ReportResponse;
import ai.openapk.core.reports.dto.ReportSection;
import ai.openapk.core.reports.dto.UpdateReportRequest;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.server.ResponseStatusException;
import tools.jackson.core.type.TypeReference;
import tools.jackson.databind.ObjectMapper;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Instant;
import java.time.format.DateTimeFormatter;
import java.util.ArrayList;
import java.util.Base64;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

@Service
public class ProjectReportService {

    private static final Logger log = LoggerFactory.getLogger(ProjectReportService.class);

    // ---------- MAR (Malware Analysis Report) sections ----------
    /** Section IDs are stable; section titles can be edited. */
    public static final String SECTION_OVERVIEW = "sample_overview";
    public static final String SECTION_FINDINGS = "static_findings";
    public static final String SECTION_IOCS = "iocs";
    public static final String SECTION_RECOMMENDATIONS = "recommendations";
    public static final String SECTION_NOTES = "notes";

    // ---------- VRR (Vulnerability Research Report) sections ----------
    public static final String SECTION_VRR_TARGET = "target_overview";
    public static final String SECTION_VRR_ATTACK_SURFACE = "attack_surface";
    public static final String SECTION_VRR_AUTH_STORAGE = "auth_and_data_storage";
    public static final String SECTION_VRR_NETWORK = "network_security";
    public static final String SECTION_VRR_VULNERABILITIES = "vulnerabilities";
    public static final String SECTION_VRR_REPRO = "repro_steps";
    public static final String SECTION_VRR_REMEDIATION = "remediation";
    public static final String SECTION_VRR_NOTES = "researcher_notes";

    // ---------- BIN-specific section IDs ----------
    // Distinct IDs (not just reused APK ones) so the populate switch can
    // hand each kind a tailored renderer if it ever needs to diverge from
    // the APK rendering. For now they reuse the same render functions via
    // explicit cases in renderForSection().
    public static final String SECTION_BIN_OVERVIEW = "bin_overview";
    public static final String SECTION_BIN_FINDINGS = "bin_findings";
    public static final String SECTION_BIN_IOCS = "bin_iocs";
    public static final String SECTION_BIN_SUSPICIOUS = "bin_suspicious";
    public static final String SECTION_BIN_RECOMMENDATIONS = "bin_recommendations";
    public static final String SECTION_BIN_NOTES = "bin_notes";
    public static final String SECTION_BIN_VRR_TARGET = "bin_target_overview";
    public static final String SECTION_BIN_VRR_ATTACK_SURFACE = "bin_attack_surface";
    public static final String SECTION_BIN_VRR_VULNERABILITIES = "bin_vulnerabilities";
    public static final String SECTION_BIN_VRR_REPRO = "bin_repro_steps";
    public static final String SECTION_BIN_VRR_REMEDIATION = "bin_remediation";
    public static final String SECTION_BIN_VRR_NOTES = "bin_researcher_notes";

    private final ProjectRepository projectRepo;
    private final ProjectReportRepository reportRepo;
    private final ObjectMapper mapper;
    private final ProjectStorage storage;
    private final ai.openapk.core.notifications.NotificationService notifications;
    private final ProjectAccessGuard guard;
    private final ReportContributorService contributors;

    public ProjectReportService(
            ProjectRepository projectRepo,
            ProjectReportRepository reportRepo,
            ObjectMapper mapper,
            ProjectStorage storage,
            ai.openapk.core.notifications.NotificationService notifications,
            ProjectAccessGuard guard,
            ReportContributorService contributors
    ) {
        this.projectRepo = projectRepo;
        this.reportRepo = reportRepo;
        this.mapper = mapper;
        this.storage = storage;
        this.notifications = notifications;
        this.guard = guard;
        this.contributors = contributors;
    }

    @Transactional
    public ReportResponse getOrCreate(User user, UUID projectId) {
        // VIEWER-OK: any collaborator can see the report. The lazy
        // createDefault is benign — initializes empty sections from the
        // project's analysis mode, no user-driven content.
        Project project = guard.requireRead(user, projectId);
        ProjectReport report = reportRepo.findByProjectId(projectId).orElseGet(() -> createDefault(project));
        return toResponse(report);
    }

    @Transactional
    public ReportResponse update(User user, UUID projectId, UpdateReportRequest req) {
        Project project = guard.requireEdit(user, projectId);
        ProjectReport report = reportRepo.findByProjectId(projectId).orElseGet(() -> createDefault(project));
        requireNotPublished(report);
        report.setTitle(req.title());
        report.setSectionsJson(serializeSections(req.sections()));
        report.setUpdatedBy(user);
        advanceWorkflowOnEdit(project);
        return toResponse(reportRepo.save(report));
    }

    @Transactional
    public ReportResponse populate(User user, UUID projectId, PopulateRequest req) {
        Project project = guard.requireEdit(user, projectId);
        if (project.getLatestAnalysisJson() == null || project.getLatestAnalysisJson().isBlank()) {
            throw new ResponseStatusException(HttpStatus.CONFLICT,
                    "No analysis result cached yet. Run an analysis from the project view first.");
        }
        AnalysisResponse analysis;
        try {
            analysis = mapper.readValue(project.getLatestAnalysisJson(), AnalysisResponse.class);
        } catch (Exception e) {
            throw new ResponseStatusException(HttpStatus.INTERNAL_SERVER_ERROR,
                    "Cached analysis is unreadable; re-run analysis. " + e.getMessage());
        }

        ProjectReport report = reportRepo.findByProjectId(projectId).orElseGet(() -> createDefault(project));
        requireNotPublished(report);
        List<ReportSection> sections = deserializeSections(report.getSectionsJson());
        sections = sections.stream()
                .map(s -> s.id().equals(req.sectionId())
                        ? new ReportSection(s.id(), s.title(), renderForSection(s.id(), analysis))
                        : s)
                .toList();
        report.setSectionsJson(serializeSections(sections));
        report.setUpdatedBy(user);
        advanceWorkflowOnEdit(project);
        return toResponse(reportRepo.save(report));
    }

    @Transactional
    public ReportResponse publish(User user, UUID projectId) {
        // Locking the report (not the same as community publish) is an
        // EDITOR-level workflow action. Community publish below is owner-only.
        Project project = guard.requireEdit(user, projectId);
        ProjectReport report = reportRepo.findByProjectId(projectId).orElseGet(() -> createDefault(project));
        if (report.getPublishedAt() == null) {
            report.setPublishedAt(Instant.now());
        }
        project.setWorkflowStatus(WorkflowStatus.PUBLISHED);
        projectRepo.save(project);
        return toResponse(reportRepo.save(report));
    }

    @Transactional
    public ReportResponse unpublish(User user, UUID projectId) {
        Project project = guard.requireEdit(user, projectId);
        ProjectReport report = reportRepo.findByProjectId(projectId)
                .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND, "report not found"));
        report.setPublishedAt(null);
        if (project.getWorkflowStatus() == WorkflowStatus.PUBLISHED) {
            project.setWorkflowStatus(WorkflowStatus.DRAFTING_REPORT);
            projectRepo.save(project);
        }
        return toResponse(reportRepo.save(report));
    }

    /**
     * Publish the report to the anonymous /community feed. Snapshots the
     * malware-type + tags at the same time so the feed always reflects the
     * author's chosen categorization (versus pulling them from project
     * state that could drift). Also locks the report (sets publishedAt) so
     * the public version is stable — un-publishing from community keeps
     * the lock unless the caller explicitly unpublishes that too.
     */
    @Transactional
    public ReportResponse publishToCommunity(User user, UUID projectId, CommunityPublishRequest req) {
        // OWNER-only: publishing to the anonymous community feed is
        // irreversible-ish (the report URL gets crawled) so we keep this
        // gate tighter than the rest of the report surface. Collaborators
        // contribute to drafting but the owner decides what goes public.
        Project project = guard.requireOwner(user, projectId);
        ProjectReport report = reportRepo.findByProjectId(projectId).orElseGet(() -> createDefault(project));

        // Validate malware_type against the STIX 2.1 vocab. Null is allowed
        // (author didn't pick) but a non-null value must be in the open vocab.
        String malwareType = req.malwareType() == null || req.malwareType().isBlank() ? null : req.malwareType();
        if (malwareType != null && !MalwareTypes.isValid(malwareType)) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST,
                    "malware_type must be one of the STIX 2.1 malware-type vocabulary values");
        }

        // Normalize tags: trim, lowercase, drop blanks, dedupe. The migration
        // doesn't enforce caps so we do it here — 8 tags / 32 chars each.
        String[] tags = normalizeTags(req.tags());

        report.setMalwareType(malwareType);
        report.setTags(tags);
        // Track whether this call is the one that flipped the report into
        // the community feed — we only want to fire the "your report is
        // live" email on the first publish, not on every re-publish edit.
        boolean firstPublishToCommunity = report.getCommunityPublishedAt() == null;
        if (firstPublishToCommunity) {
            report.setCommunityPublishedAt(Instant.now());
        }
        if (report.getPublishedAt() == null) {
            report.setPublishedAt(Instant.now());
        }
        if (project.getWorkflowStatus() != WorkflowStatus.PUBLISHED) {
            project.setWorkflowStatus(WorkflowStatus.PUBLISHED);
            projectRepo.save(project);
        }
        ProjectReport saved = reportRepo.save(report);
        // Freeze the contributor byline from the current attributed state.
        // Rebuilt on every (re)publish so the owner can re-curate credits by
        // republishing after roster/contribution changes.
        contributors.snapshot(saved);
        if (firstPublishToCommunity) {
            notifications.notifyReportPublished(user, saved);
        }
        return toResponse(saved);
    }

    /**
     * Hide the report from the /community feed. Leaves publishedAt alone —
     * the report stays finalized/locked but no longer appears publicly.
     */
    @Transactional
    public ReportResponse unpublishFromCommunity(User user, UUID projectId) {
        // Symmetric with publishToCommunity: OWNER-only. An editor can't
        // unilaterally take a public report offline.
        guard.requireOwner(user, projectId);
        ProjectReport report = reportRepo.findByProjectId(projectId)
                .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND, "report not found"));
        report.setCommunityPublishedAt(null);
        return toResponse(reportRepo.save(report));
    }

    /**
     * Trim, lowercase, dedupe, cap at 8 entries / 32 chars. Returns an
     * empty array on null input so the column's NOT NULL default holds.
     */
    private static String[] normalizeTags(List<String> raw) {
        if (raw == null || raw.isEmpty()) return new String[0];
        var seen = new java.util.LinkedHashSet<String>();
        for (String t : raw) {
            if (t == null) continue;
            String trimmed = t.trim().toLowerCase();
            if (trimmed.isEmpty()) continue;
            if (trimmed.length() > 32) trimmed = trimmed.substring(0, 32);
            seen.add(trimmed);
            if (seen.size() >= 8) break;
        }
        return seen.toArray(new String[0]);
    }

    private void requireNotPublished(ProjectReport report) {
        if (report.getPublishedAt() != null) {
            throw new ResponseStatusException(HttpStatus.CONFLICT,
                    "Report is published. Unpublish first to make changes.");
        }
    }

    private void advanceWorkflowOnEdit(Project project) {
        if (WorkflowStatus.shouldAdvance(project.getWorkflowStatus(), WorkflowStatus.DRAFTING_REPORT)) {
            project.setWorkflowStatus(WorkflowStatus.DRAFTING_REPORT);
            projectRepo.save(project);
        }
    }

    @Transactional(readOnly = true)
    public String exportMarkdown(User user, UUID projectId) {
        Project project = guard.requireRead(user, projectId);
        ProjectReport report = reportRepo.findByProjectId(projectId).orElse(null);
        StringBuilder sb = new StringBuilder();
        String title = report == null ? "Malware Analysis Report" : report.getTitle();
        sb.append("# ").append(title).append("\n\n");
        sb.append("> Project: `").append(project.getName()).append("`  \n");
        if (!project.getName().equals(project.getOriginalFilename())) {
            sb.append("> Original filename: `").append(project.getOriginalFilename()).append("`  \n");
        }
        if (project.getPackageName() != null) {
            sb.append("> Package: `").append(project.getPackageName()).append("`  \n");
        }
        sb.append("> SHA-256: `").append(project.getSha256()).append("`  \n");
        if (report != null && report.getPublishedAt() != null) {
            sb.append("> Published: ").append(DateTimeFormatter.ISO_INSTANT.format(report.getPublishedAt())).append("  \n");
        }
        sb.append("> Generated: ").append(DateTimeFormatter.ISO_INSTANT.format(Instant.now())).append("\n\n");

        List<ReportSection> sections = report == null
                ? defaultSections(project)
                : deserializeSections(report.getSectionsJson());
        for (ReportSection s : sections) {
            sb.append("## ").append(s.title()).append("\n\n");
            String content = s.content() == null ? "" : s.content().strip();
            sb.append(content.isEmpty() ? "_(empty)_" : content).append("\n\n");
        }
        // Inline /api/...media/... refs as base64 data URLs so the exported .md
        // is portable (no broken localhost links when shared outside the host).
        return inlineMediaImages(sb.toString(), user, projectId);
    }

    /**
     * Replace every `![alt](/api/projects/{projectId}/media/{file})` reference with a
     * base64 data URL so the resulting markdown stands alone. References to other
     * URLs (external http, project IDs not matching) are left untouched.
     * Missing files are also left as-is so the user can spot broken links.
     */
    private String inlineMediaImages(String md, User user, UUID projectId) {
        Pattern p = Pattern.compile(
                "!\\[([^\\]]*)]\\(/api/projects/" + projectId + "/media/([0-9a-f-]{36}\\.png)\\)"
        );
        Matcher m = p.matcher(md);
        StringBuilder out = new StringBuilder();
        while (m.find()) {
            String alt = m.group(1);
            String filename = m.group(2);
            Path file = storage.mediaDir(user.getId(), projectId).resolve(filename);
            String replacement;
            if (Files.exists(file)) {
                try {
                    byte[] bytes = Files.readAllBytes(file);
                    replacement = "![" + alt + "](data:image/png;base64,"
                            + Base64.getEncoder().encodeToString(bytes) + ")";
                } catch (IOException e) {
                    log.warn("failed to inline media {}: {}", file, e.toString());
                    replacement = m.group(0);
                }
            } else {
                log.warn("export references missing media: {}", file);
                replacement = m.group(0);
            }
            m.appendReplacement(out, Matcher.quoteReplacement(replacement));
        }
        m.appendTail(out);
        return out.toString();
    }

    private ProjectReport createDefault(Project project) {
        var report = new ProjectReport();
        report.setProject(project);
        report.setTitle(defaultTitle(project));
        report.setSectionsJson(serializeSections(defaultSections(project)));
        return reportRepo.save(report);
    }

    private String defaultTitle(Project project) {
        boolean vrr = project.getAnalysisMode() == AnalysisMode.VULN_RESEARCH;
        boolean bin = project.getKind() == ProjectKind.BIN;
        if (vrr) return bin ? "Binary Vulnerability Research Report" : "Vulnerability Research Report";
        return bin ? "Binary Malware Analysis Report" : "Malware Analysis Report";
    }

    /**
     * Default section template, selected by the project's kind + primary
     * analysis mode. APK templates ship sections referencing the APK-only
     * tabs (Entry points, Crypto, DBs, Network); BIN templates reference
     * the BIN-only inspector tabs (Imports, Strings, Xrefs, Chain) and
     * carry a binary-flavored overview header instead of package metadata.
     */
    private List<ReportSection> defaultSections(Project project) {
        boolean vrr = project.getAnalysisMode() == AnalysisMode.VULN_RESEARCH;
        if (project.getKind() == ProjectKind.BIN) {
            return vrr ? binVrrSections(project) : binMarSections(project);
        }
        return vrr ? vrrSections(project) : marSections(project);
    }

    private List<ReportSection> marSections(Project project) {
        return List.of(
                new ReportSection(SECTION_OVERVIEW, "Sample Overview", overviewMarkdown(project)),
                new ReportSection(SECTION_FINDINGS, "Static Analysis Findings", ""),
                new ReportSection(SECTION_IOCS, "Indicators of Compromise", ""),
                new ReportSection(SECTION_RECOMMENDATIONS, "Recommendations", ""),
                new ReportSection(SECTION_NOTES, "Analyst Notes", "")
        );
    }

    private List<ReportSection> vrrSections(Project project) {
        return List.of(
                new ReportSection(SECTION_VRR_TARGET, "Target Application", overviewMarkdown(project)),
                new ReportSection(SECTION_VRR_ATTACK_SURFACE, "Attack Surface",
                        "Exported components, deep links, IPC endpoints, and any other entry " +
                        "points an attacker can reach. Use the Entry points tab to walk the " +
                        "manifest, and link to specific files with `[label](path:line)`.\n"),
                new ReportSection(SECTION_VRR_AUTH_STORAGE, "Authentication & Data Storage",
                        "Auth flows, token handling, key management, SharedPreferences modes, " +
                        "external-storage usage, SQLite/Room schemas, encryption at rest. " +
                        "See the Crypto and DBs tabs for cross-references.\n"),
                new ReportSection(SECTION_VRR_NETWORK, "Network Security",
                        "TLS configuration, certificate pinning, cleartext traffic policy, " +
                        "and observed endpoints. The Network tab enumerates Retrofit / OkHttp " +
                        "/ HttpURLConnection call sites with the URLs they build.\n"),
                new ReportSection(SECTION_VRR_VULNERABILITIES, "Vulnerabilities",
                        "Populate this section from a `/analyze` run in Vulnerability Research " +
                        "mode. Each finding should include severity, CWE mapping, affected " +
                        "file(s), and a one-line description.\n"),
                new ReportSection(SECTION_VRR_REPRO, "Reproduction Steps", ""),
                new ReportSection(SECTION_VRR_REMEDIATION, "Remediation", ""),
                new ReportSection(SECTION_VRR_NOTES, "Researcher Notes", "")
        );
    }

    private String overviewMarkdown(Project project) {
        return "- **Filename**: `" + project.getOriginalFilename() + "`\n" +
                (project.getPackageName() != null ? "- **Package**: `" + project.getPackageName() + "`\n" : "") +
                "- **Size**: " + formatBytes(project.getSizeBytes()) + "\n" +
                "- **SHA-256**: `" + project.getSha256() + "`\n" +
                "- **Uploaded**: " + DateTimeFormatter.ISO_INSTANT.format(project.getCreatedAt()) + "\n";
    }

    /**
     * BIN-flavored overview. Drops APK-only PackageName, surfaces the
     * Ghidra-extracted metadata (executable format / arch / compiler /
     * Ghidra language id / image base) when present, and gates each row on
     * non-null so a BIN project that hasn't completed analysis yet still
     * gets a usable overview from filename + sha256 + upload date alone.
     */
    private String binOverviewMarkdown(Project project) {
        StringBuilder sb = new StringBuilder();
        sb.append("- **Filename**: `").append(project.getOriginalFilename()).append("`\n");
        if (project.getExecutableFormat() != null) {
            sb.append("- **Format**: ").append(project.getExecutableFormat()).append("\n");
        }
        if (project.getArch() != null) {
            sb.append("- **Architecture**: ").append(project.getArch()).append("\n");
        }
        if (project.getCompiler() != null) {
            sb.append("- **Compiler**: ").append(project.getCompiler()).append("\n");
        }
        if (project.getLanguageId() != null) {
            sb.append("- **Ghidra language**: `").append(project.getLanguageId()).append("`\n");
        }
        if (project.getImageBase() != null) {
            sb.append("- **Image base**: `").append(project.getImageBase()).append("`\n");
        }
        sb.append("- **Size**: ").append(formatBytes(project.getSizeBytes())).append("\n");
        sb.append("- **SHA-256**: `").append(project.getSha256()).append("`\n");
        sb.append("- **Uploaded**: ")
                .append(DateTimeFormatter.ISO_INSTANT.format(project.getCreatedAt())).append("\n");
        return sb.toString();
    }

    /**
     * BIN-flavored MAR. Same shape as the APK MAR but section descriptions
     * point at the OpenBin inspector tabs (Imports / Strings / Xrefs /
     * Chain / Renames) and the AI panel rather than the JADX file tree.
     * Findings + IoCs sections stay empty; the user populates them from a
     * /analyze run in MALWARE mode.
     */
    private List<ReportSection> binMarSections(Project project) {
        return List.of(
                new ReportSection(SECTION_BIN_OVERVIEW, "Sample Overview", binOverviewMarkdown(project)),
                new ReportSection(SECTION_BIN_FINDINGS, "Static Analysis Findings", ""),
                new ReportSection(SECTION_BIN_IOCS, "Indicators of Compromise", ""),
                new ReportSection(SECTION_BIN_SUSPICIOUS, "Suspicious Functions & Imports",
                        "List Ghidra-resolved functions or imports that stood out — anti-debug, " +
                        "anti-VM, packer stubs, syscall wrappers, network primitives, crypto, etc. " +
                        "Cross-reference with the **Imports** and **Strings** side-panel tabs; " +
                        "link specific functions inline with their address or rename.\n"),
                new ReportSection(SECTION_BIN_RECOMMENDATIONS, "Recommendations", ""),
                new ReportSection(SECTION_BIN_NOTES, "Analyst Notes", "")
        );
    }

    /**
     * BIN-flavored VRR. Six sections: target overview, attack surface (entry
     * points + imports + exported syms), vulnerabilities (populate from
     * /analyze in VULN_RESEARCH mode), repro, remediation, notes. No
     * auth-storage or network-security sections — those are APK-flavored
     * Android concerns; binary work cares more about parsing primitives,
     * memory safety, and import surfaces.
     */
    private List<ReportSection> binVrrSections(Project project) {
        return List.of(
                new ReportSection(SECTION_BIN_VRR_TARGET, "Target Binary", binOverviewMarkdown(project)),
                new ReportSection(SECTION_BIN_VRR_ATTACK_SURFACE, "Attack Surface",
                        "Entry point, exported symbols, imported functions, and any other " +
                        "externally-reachable code paths. Walk the **Imports** tab for the call " +
                        "boundary; the **Xrefs** + **Chain** tabs trace inward from any function " +
                        "that handles untrusted input.\n"),
                new ReportSection(SECTION_BIN_VRR_VULNERABILITIES, "Vulnerabilities",
                        "Populate this section from a `/analyze` run in Vulnerability Research " +
                        "mode. Each finding should include severity, CWE mapping, the function " +
                        "name (or address), and a one-line description.\n"),
                new ReportSection(SECTION_BIN_VRR_REPRO, "Reproduction Steps", ""),
                new ReportSection(SECTION_BIN_VRR_REMEDIATION, "Remediation / Mitigation", ""),
                new ReportSection(SECTION_BIN_VRR_NOTES, "Researcher Notes", "")
        );
    }

    private static String formatBytes(long n) {
        if (n < 1024) return n + " B";
        if (n < 1024 * 1024) return String.format("%.1f KB", n / 1024.0);
        return String.format("%.1f MB", n / (1024.0 * 1024.0));
    }

    private String renderForSection(String sectionId, AnalysisResponse analysis) {
        return switch (sectionId) {
            // MAR-flow populate targets
            case SECTION_FINDINGS, SECTION_BIN_FINDINGS -> renderFindings(analysis);
            case SECTION_IOCS, SECTION_BIN_IOCS -> renderIocs(analysis);
            // VRR-flow populate targets
            case SECTION_VRR_VULNERABILITIES, SECTION_BIN_VRR_VULNERABILITIES -> renderVulnerabilities(analysis);
            case SECTION_VRR_ATTACK_SURFACE, SECTION_BIN_VRR_ATTACK_SURFACE -> renderAttackSurfacePointer(analysis);
            // network_security is APK-only; BIN has no equivalent
            case SECTION_VRR_NETWORK -> renderNetworkPointer(analysis);
            default -> ""; // populate not supported for narrative sections
        };
    }

    /**
     * VRR "Vulnerabilities" populate: render each hotspot as a finding with
     * severity badge + file pointer + CWE placeholder. Researchers fill in
     * the CWE id and impact paragraph manually; the agent gives them the
     * file + reasoning to start from.
     */
    private String renderVulnerabilities(AnalysisResponse a) {
        StringBuilder sb = new StringBuilder();
        sb.append("**Mode**: ").append(a.mode()).append("  ·  **Model**: `").append(a.model()).append("`\n\n");
        sb.append("### Summary\n\n").append(a.summary()).append("\n\n");
        if (a.hotspots().isEmpty()) {
            sb.append("_No hotspots identified by the agent._\n");
            return sb.toString();
        }
        sb.append("### Findings\n\n");
        int n = 1;
        for (var h : a.hotspots()) {
            sb.append("#### Finding ").append(n++).append(" — ")
              .append(h.severity().toUpperCase()).append("\n\n");
            sb.append("- **File**: `").append(h.path()).append("`\n");
            sb.append("- **Severity**: ").append(h.severity()).append("\n");
            sb.append("- **CWE**: _TODO — map to CWE-XXX_\n");
            sb.append("- **Description**: ").append(h.reason()).append("\n");
            sb.append("- **Impact**: _TODO — describe what an attacker can do_\n\n");
        }
        return sb.toString();
    }

    /**
     * VRR "Attack Surface" populate: light touch — drop the summary as a header
     * and list any hotspots whose reason mentions exported components / deep
     * links / IPC. Researchers usually fill this in by hand from the Entry
     * points tab; this just seeds it.
     */
    private String renderAttackSurfacePointer(AnalysisResponse a) {
        StringBuilder sb = new StringBuilder();
        sb.append("_Seeded from `/analyze` in VULN_RESEARCH mode. Cross-reference with the Entry points tab._\n\n");
        sb.append("**Summary**: ").append(a.summary()).append("\n\n");
        if (a.hotspots().isEmpty()) return sb.toString();
        sb.append("### Hotspots referencing entry-point patterns\n\n");
        boolean any = false;
        for (var h : a.hotspots()) {
            String reason = h.reason() == null ? "" : h.reason().toLowerCase();
            if (reason.contains("export") || reason.contains("deep") || reason.contains("intent")
                    || reason.contains("ipc") || reason.contains("receiver") || reason.contains("provider")) {
                sb.append("- **[").append(h.severity().toUpperCase()).append("] `")
                  .append(h.path()).append("`** — ").append(h.reason()).append("\n");
                any = true;
            }
        }
        if (!any) sb.append("_No hotspots flagged entry-point concerns. Walk the Entry points tab manually._\n");
        return sb.toString();
    }

    /**
     * VRR "Network Security" populate: same lightweight pattern as attack
     * surface — drop a header and any hotspots tagged with network-y words.
     */
    private String renderNetworkPointer(AnalysisResponse a) {
        StringBuilder sb = new StringBuilder();
        sb.append("_Seeded from `/analyze` in VULN_RESEARCH mode. Cross-reference with the Network tab._\n\n");
        if (a.hotspots().isEmpty()) return sb.toString();
        sb.append("### Hotspots referencing network patterns\n\n");
        boolean any = false;
        for (var h : a.hotspots()) {
            String reason = h.reason() == null ? "" : h.reason().toLowerCase();
            if (reason.contains("http") || reason.contains("network") || reason.contains("cleartext")
                    || reason.contains("tls") || reason.contains("ssl") || reason.contains("cert")
                    || reason.contains("url") || reason.contains("c2") || reason.contains("endpoint")) {
                sb.append("- **[").append(h.severity().toUpperCase()).append("] `")
                  .append(h.path()).append("`** — ").append(h.reason()).append("\n");
                any = true;
            }
        }
        if (!any) sb.append("_No hotspots flagged network concerns. See the Network tab for the full HTTP call-site list._\n");
        return sb.toString();
    }

    private String renderFindings(AnalysisResponse a) {
        StringBuilder sb = new StringBuilder();
        sb.append("**Mode**: ").append(a.mode()).append("\n\n");
        sb.append("### Summary\n\n").append(a.summary()).append("\n\n");
        if (!a.hotspots().isEmpty()) {
            sb.append("### Hotspots\n\n");
            for (var h : a.hotspots()) {
                sb.append("- **[").append(h.severity().toUpperCase()).append("] `")
                  .append(h.path()).append("`** — ").append(h.reason()).append("\n");
            }
            sb.append("\n");
        }
        if (!a.nextSteps().isEmpty()) {
            sb.append("### Recommended Next Steps\n\n");
            for (var s : a.nextSteps()) sb.append("- ").append(s).append("\n");
            sb.append("\n");
        }
        return sb.toString();
    }

    private String renderIocs(AnalysisResponse a) {
        if (a.iocs().isEmpty()) return "_No indicators of compromise extracted._\n";
        Map<String, List<ai.openapk.core.analysis.dto.Ioc>> grouped = new LinkedHashMap<>();
        for (var ioc : a.iocs()) grouped.computeIfAbsent(ioc.type(), k -> new ArrayList<>()).add(ioc);
        StringBuilder sb = new StringBuilder();
        for (var entry : grouped.entrySet()) {
            sb.append("### ").append(capitalize(entry.getKey())).append("\n\n");
            for (var ioc : entry.getValue()) {
                sb.append("- `").append(ioc.value()).append("` (×").append(ioc.occurrences()).append(")\n");
            }
            sb.append("\n");
        }
        return sb.toString();
    }

    private static String capitalize(String s) {
        return s.isEmpty() ? s : Character.toUpperCase(s.charAt(0)) + s.substring(1);
    }

    private ReportResponse toResponse(ProjectReport r) {
        return new ReportResponse(
                r.getId(),
                r.getProject().getId(),
                r.getTitle(),
                deserializeSections(r.getSectionsJson()),
                r.getCreatedAt(),
                r.getUpdatedAt(),
                r.getPublishedAt(),
                r.getCommunityPublishedAt(),
                r.getMalwareType(),
                r.getTags() == null ? List.of() : List.of(r.getTags())
        );
    }

    private String serializeSections(List<ReportSection> sections) {
        try {
            return mapper.writeValueAsString(Map.of("sections", sections));
        } catch (Exception e) {
            throw new IllegalStateException("section serialization failed", e);
        }
    }

    private List<ReportSection> deserializeSections(String json) {
        if (json == null || json.isBlank()) return List.of();
        try {
            Map<String, List<ReportSection>> root = mapper.readValue(json, new TypeReference<Map<String, List<ReportSection>>>() {});
            return root.getOrDefault("sections", List.of());
        } catch (Exception e) {
            log.warn("section deserialization failed: {}", e.toString());
            return List.of();
        }
    }
}
