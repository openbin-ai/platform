package ai.openapk.core.analysis.agent;

import ai.openapk.core.analysis.AnalysisService;
import ai.openapk.core.highlights.HighlightType;
import ai.openapk.core.highlights.ProjectHighlightService;
import ai.openapk.core.highlights.dto.CreateHighlightRequest;
import ai.openapk.core.projects.ProjectKind;
import ai.openapk.core.projects.ProjectService;
import ai.openapk.core.projects.dto.FileContentResponse;
import ai.openapk.core.renames.RenameService;
import ai.openapk.core.reports.ProjectReportService;
import ai.openapk.core.scripts.ProjectScriptService;
import ai.openapk.core.scripts.dto.CreateScriptRequest;
import ai.openapk.core.search.SearchService;
import ai.openapk.core.search.dto.SearchHit;
import org.springframework.stereotype.Component;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;

import java.util.ArrayList;
import java.util.List;
import java.util.Locale;
import java.util.regex.Pattern;

/**
 * The tools BINNY light may call, chosen per project kind and per caller
 * role. Read tools ground the answer in the project; write tools act on it
 * through the same services the UI uses, so every highlight, report section
 * and script is attributed to the signed-in user and obeys the same
 * permission checks. Nothing here executes anything.
 *
 * <p>Tool output is capped: every call's result is re-sent on every later
 * turn of the loop, so a 60 KB file read would be paid for several times.
 */
@Component
public class BinnyToolkit {

    static final int MAX_RESULT_CHARS = 12_000;
    static final int MAX_DISASM_LINES = 200;
    static final int MAX_HITS = 40;

    private final ObjectMapper mapper;
    private final RenameService renames;
    private final ProjectService projectService;
    private final SearchService search;
    private final ProjectHighlightService highlights;
    private final ProjectReportService reports;
    private final ProjectScriptService scripts;

    public BinnyToolkit(ObjectMapper mapper, RenameService renames, ProjectService projectService,
                        SearchService search, ProjectHighlightService highlights,
                        ProjectReportService reports, ProjectScriptService scripts) {
        this.mapper = mapper;
        this.renames = renames;
        this.projectService = projectService;
        this.search = search;
        this.highlights = highlights;
        this.reports = reports;
        this.scripts = scripts;
    }

    /** Tools for this request: kind-specific readers, plus writers for editors. */
    public List<BinnyTool> toolsFor(BinnyToolContext ctx) {
        List<BinnyTool> out = new ArrayList<>();
        switch (ctx.kind()) {
            case BIN -> { out.add(new GetFunction()); out.add(new FindFunctions()); out.add(new ListStrings()); }
            case APK -> { out.add(new ReadFile()); out.add(new SearchCode()); }
            case SCRIPT -> { /* the file arrives inline; no server-side reads */ }
        }
        if (ctx.canEdit()) {
            out.add(new CreateHighlight());
            out.add(new WriteReportSection());
            out.add(new SaveScript());
        }
        return out;
    }

    private JsonNode schema(String json) {
        return mapper.readTree(json);
    }

    static String str(JsonNode input, String field) {
        JsonNode n = input.path(field);
        return n.isMissingNode() || n.isNull() ? null : n.asString();
    }

    static int intOr(JsonNode input, String field, int dflt) {
        JsonNode n = input.path(field);
        return n.isNumber() ? n.asInt() : dflt;
    }

    static String cap(String s, int max) {
        if (s == null) return "";
        return s.length() <= max ? s : s.substring(0, max) + "\n[... truncated at " + max + " chars]";
    }

    // --- BIN -----------------------------------------------------------------------

    final class GetFunction implements BinnyTool {
        public ToolDef def() {
            return new ToolDef("get_function",
                    "Fetch another function from this binary: its signature, Ghidra's decompiled C, and the first "
                            + MAX_DISASM_LINES + " disassembly lines. Use the name as shown in the code "
                            + "(FUN_xxxx or a renamed symbol). Call this before reasoning about a callee you cannot see.",
                    schema("""
                            {"type":"object","properties":{"name":{"type":"string","description":"function name"}},
                             "required":["name"]}"""));
        }
        public boolean writes() { return false; }
        public Outcome run(BinnyToolContext ctx, JsonNode input) {
            String name = str(input, "name");
            if (name == null || name.isBlank()) return Outcome.of("error: name is required", "get_function: missing name");
            JsonNode root = ctx.analysis().get();
            String original = renames.resolveOriginal(ctx.projectId(), name.trim());
            JsonNode fn = AnalysisService.findFunctionByName(root.path("functions"), original);
            if (fn == null) return Outcome.of("No function named '" + name + "' in this binary.", "get_function: " + name + " not found");
            StringBuilder sb = new StringBuilder();
            sb.append("Function: ").append(name).append('\n');
            sb.append("Address: ").append(fn.path("address").asString("")).append('\n');
            sb.append("Signature: ").append(fn.path("signature").asString("")).append("\n\n");
            String dec = fn.path("decompiled").isNull() ? "" : fn.path("decompiled").asString("");
            if (dec.isBlank()) sb.append("(no decompiled output: external or thunk)\n");
            else sb.append("--- DECOMPILED ---\n").append(cap(dec, 8_000)).append("\n--- END ---\n");
            JsonNode dis = fn.path("disassembly");
            if (dis.isArray() && !dis.isEmpty()) {
                sb.append("\n--- DISASSEMBLY (first ").append(Math.min(MAX_DISASM_LINES, dis.size())).append(" of ").append(dis.size()).append(") ---\n");
                int n = 0;
                for (JsonNode line : dis) {
                    if (n++ >= MAX_DISASM_LINES) break;
                    sb.append(line.path("addr").asString("")).append("  ").append(line.path("text").asString("")).append('\n');
                }
            }
            return Outcome.of(cap(sb.toString(), MAX_RESULT_CHARS), "read " + name);
        }
    }

    final class FindFunctions implements BinnyTool {
        public ToolDef def() {
            return new ToolDef("find_functions",
                    "List functions in this binary whose name matches a case-insensitive substring or regex. "
                            + "Returns name, address and size, up to " + MAX_HITS + " hits.",
                    schema("""
                            {"type":"object","properties":{
                              "query":{"type":"string","description":"substring or regex to match against function names"},
                              "regex":{"type":"boolean","description":"treat query as a regular expression (default false)"}},
                             "required":["query"]}"""));
        }
        public boolean writes() { return false; }
        public Outcome run(BinnyToolContext ctx, JsonNode input) {
            String q = str(input, "query");
            if (q == null || q.isBlank()) return Outcome.of("error: query is required", "find_functions: missing query");
            boolean regex = input.path("regex").asBoolean(false);
            Pattern p;
            try {
                p = Pattern.compile(regex ? q : Pattern.quote(q), Pattern.CASE_INSENSITIVE);
            } catch (Exception e) {
                return Outcome.of("error: bad regex: " + e.getMessage(), "find_functions: bad regex");
            }
            StringBuilder sb = new StringBuilder();
            int hits = 0, total = 0;
            for (JsonNode fn : ctx.analysis().get().path("functions")) {
                String name = fn.path("name").asString("");
                if (!p.matcher(name).find()) continue;
                total++;
                if (hits >= MAX_HITS) continue;
                hits++;
                sb.append(name).append(" @ ").append(fn.path("address").asString(""));
                if (fn.path("size").isNumber()) sb.append(" (").append(fn.path("size").asInt()).append(" bytes)");
                sb.append('\n');
            }
            if (total == 0) return Outcome.of("No function names match '" + q + "'.", "find_functions: no match");
            if (total > hits) sb.append("... ").append(total - hits).append(" more not shown; narrow the query.\n");
            return Outcome.of(sb.toString(), "found " + total + " function" + (total == 1 ? "" : "s"));
        }
    }

    final class ListStrings implements BinnyTool {
        public ToolDef def() {
            return new ToolDef("list_strings",
                    "Search the strings Ghidra extracted from this binary (case-insensitive substring). Up to 60 hits.",
                    schema("""
                            {"type":"object","properties":{"query":{"type":"string","description":"substring to look for; empty lists the first strings"}}}"""));
        }
        public boolean writes() { return false; }
        public Outcome run(BinnyToolContext ctx, JsonNode input) {
            String q = str(input, "query");
            String needle = q == null ? "" : q.toLowerCase(Locale.ROOT);
            StringBuilder sb = new StringBuilder();
            int hits = 0, total = 0;
            for (JsonNode s : ctx.analysis().get().path("strings")) {
                String v = s.isTextual() ? s.asString() : s.path("value").asString(s.path("string").asString(""));
                if (!needle.isEmpty() && !v.toLowerCase(Locale.ROOT).contains(needle)) continue;
                total++;
                if (hits >= 60) continue;
                hits++;
                if (!s.isTextual() && s.has("address")) sb.append(s.path("address").asString("")).append("  ");
                sb.append(cap(v, 300)).append('\n');
            }
            if (total == 0) return Outcome.of("No strings match '" + q + "'.", "list_strings: no match");
            if (total > hits) sb.append("... ").append(total - hits).append(" more not shown.\n");
            return Outcome.of(cap(sb.toString(), MAX_RESULT_CHARS), total + " string" + (total == 1 ? "" : "s"));
        }
    }

    // --- APK -----------------------------------------------------------------------

    final class ReadFile implements BinnyTool {
        public ToolDef def() {
            return new ToolDef("read_file",
                    "Read a file from the decompiled tree (Java, Kotlin, smali, the manifest, resources) by its path. "
                            + "Optional 1-based start_line and end_line return a slice; without them the first 12 KB.",
                    schema("""
                            {"type":"object","properties":{
                              "path":{"type":"string","description":"path as shown in the file tree"},
                              "start_line":{"type":"integer"},
                              "end_line":{"type":"integer"}},
                             "required":["path"]}"""));
        }
        public boolean writes() { return false; }
        public Outcome run(BinnyToolContext ctx, JsonNode input) {
            String path = str(input, "path");
            if (path == null || path.isBlank()) return Outcome.of("error: path is required", "read_file: missing path");
            FileContentResponse f;
            try {
                f = projectService.readFile(ctx.user(), ctx.projectId(), path.trim());
            } catch (Exception e) {
                return Outcome.of("error: " + e.getMessage(), "read_file: " + path + " failed");
            }
            if (f.content() == null || "binary".equals(f.encoding())) {
                return Outcome.of("That file is binary; nothing to read as text.", "read_file: binary");
            }
            int start = intOr(input, "start_line", 0), end = intOr(input, "end_line", 0);
            String body = f.content();
            if (start > 0 || end > 0) {
                String[] lines = body.split("\n", -1);
                int from = Math.max(1, start), to = end > 0 ? Math.min(end, lines.length) : lines.length;
                StringBuilder sb = new StringBuilder();
                for (int i = from; i <= to; i++) sb.append(i).append(": ").append(lines[i - 1]).append('\n');
                body = sb.toString();
            }
            return Outcome.of(cap(body, MAX_RESULT_CHARS), "read " + path);
        }
    }

    final class SearchCode implements BinnyTool {
        public ToolDef def() {
            return new ToolDef("search_code",
                    "Full-text search across the decompiled tree. Returns file, line and a snippet per hit, up to "
                            + MAX_HITS + ". Follow up with read_file on the interesting ones.",
                    schema("""
                            {"type":"object","properties":{
                              "query":{"type":"string"},
                              "regex":{"type":"boolean","description":"treat query as a regular expression (default false)"}},
                             "required":["query"]}"""));
        }
        public boolean writes() { return false; }
        public Outcome run(BinnyToolContext ctx, JsonNode input) {
            String q = str(input, "query");
            if (q == null || q.isBlank()) return Outcome.of("error: query is required", "search_code: missing query");
            List<SearchHit> hits;
            try {
                hits = search.search(ctx.user(), ctx.projectId(), q, false, input.path("regex").asBoolean(false), false, MAX_HITS);
            } catch (Exception e) {
                return Outcome.of("error: " + e.getMessage(), "search_code failed");
            }
            if (hits.isEmpty()) return Outcome.of("No matches for '" + q + "'.", "search_code: no match");
            StringBuilder sb = new StringBuilder();
            for (SearchHit h : hits) sb.append(h.file()).append(':').append(h.line()).append("  ").append(cap(h.snippet(), 200)).append('\n');
            return Outcome.of(cap(sb.toString(), MAX_RESULT_CHARS), hits.size() + " hit" + (hits.size() == 1 ? "" : "s"));
        }
    }

    // --- writes (editors only) -----------------------------------------------------

    final class CreateHighlight implements BinnyTool {
        public ToolDef def() {
            return new ToolDef("create_highlight",
                    "Pin a finding on the project's Highlights panel so the team sees it. target is a function name "
                            + "(native binaries) or a file path (APK / script); omit it to pin the current one. "
                            + "Put the line numbers or addresses that matter in the note. Only do this when the user "
                            + "asked you to highlight, or when you found something clearly worth flagging.",
                    schema("""
                            {"type":"object","properties":{
                              "target":{"type":"string","description":"function name or file path; defaults to what the user is looking at"},
                              "tag":{"type":"string","description":"short label, e.g. crypto, c2, persistence (max 48 chars)"},
                              "note":{"type":"string","description":"why it matters, with line numbers or addresses"}},
                             "required":["note"]}"""));
        }
        public boolean writes() { return true; }
        public Outcome run(BinnyToolContext ctx, JsonNode input) {
            String target = str(input, "target");
            if (target == null || target.isBlank()) target = ctx.unitRef();
            if (target == null || target.isBlank()) return Outcome.of("error: no target and nothing is selected", "create_highlight: no target");
            HighlightType type = ctx.kind() == ProjectKind.BIN ? HighlightType.FUNCTION : HighlightType.FILE;
            String tag = str(input, "tag");
            if (tag != null && tag.length() > 48) tag = tag.substring(0, 48);
            String note = cap(str(input, "note"), 4000);
            var h = highlights.create(ctx.user(), ctx.projectId(), new CreateHighlightRequest(type, target.trim(), null, tag, note));
            return new Outcome("Highlight created (id " + h.id() + ") on " + target + ".",
                    "highlighted " + target, new Artifact("highlight", h.id().toString(), target));
        }
    }

    final class WriteReportSection implements BinnyTool {
        public ToolDef def() {
            return new ToolDef("write_report_section",
                    "Write into the project report. section_id names an existing section (sample_overview, static_findings, "
                            + "iocs, recommendations, notes; VRR: target_overview, attack_surface, vulnerabilities, repro_steps, "
                            + "remediation; native binaries use bin_ prefixed ids such as bin_findings) or a new snake_case id. "
                            + "mode append adds to what the analyst wrote; replace overwrites the section. Markdown. "
                            + "Only when the user asked for a draft or an addition to the report.",
                    schema("""
                            {"type":"object","properties":{
                              "section_id":{"type":"string"},
                              "title":{"type":"string","description":"section title; required for a new section"},
                              "markdown":{"type":"string"},
                              "mode":{"type":"string","enum":["append","replace"],"description":"default append"}},
                             "required":["section_id","markdown"]}"""));
        }
        public boolean writes() { return true; }
        public Outcome run(BinnyToolContext ctx, JsonNode input) {
            String id = str(input, "section_id");
            String md = str(input, "markdown");
            if (id == null || id.isBlank() || md == null || md.isBlank()) {
                return Outcome.of("error: section_id and markdown are required", "write_report_section: missing fields");
            }
            id = id.trim().toLowerCase(Locale.ROOT).replaceAll("[^a-z0-9_]+", "_");
            boolean append = !"replace".equalsIgnoreCase(str(input, "mode"));
            reports.upsertSection(ctx.user(), ctx.projectId(), id, str(input, "title"), cap(md, 60_000), append);
            return new Outcome((append ? "Appended to" : "Replaced") + " report section '" + id + "'.",
                    (append ? "appended to " : "replaced ") + id, new Artifact("report_section", id, id));
        }
    }

    final class SaveScript implements BinnyTool {
        public ToolDef def() {
            return new ToolDef("save_script",
                    "Save a script on the project (a decryptor, an extractor, a CyberChef recipe) so the team can "
                            + "view and download it. It is stored, not run. Include a short description of what it "
                            + "does and the inputs it expects.",
                    schema("""
                            {"type":"object","properties":{
                              "name":{"type":"string","description":"file name, e.g. decrypt_strings.py"},
                              "language":{"type":"string","description":"python, bash, javascript, powershell, cyberchef, ..."},
                              "description":{"type":"string"},
                              "content":{"type":"string"}},
                             "required":["name","language","content"]}"""));
        }
        public boolean writes() { return true; }
        public Outcome run(BinnyToolContext ctx, JsonNode input) {
            String name = str(input, "name"), lang = str(input, "language"), content = str(input, "content");
            if (name == null || name.isBlank() || lang == null || lang.isBlank() || content == null || content.isBlank()) {
                return Outcome.of("error: name, language and content are required", "save_script: missing fields");
            }
            if (name.length() > 200) name = name.substring(0, 200);
            if (lang.length() > 32) lang = lang.substring(0, 32);
            var s = scripts.create(ctx.user(), ctx.projectId(), new CreateScriptRequest(
                    name, lang, cap(str(input, "description"), 2000), cap(content, 200_000), ctx.unitRef()));
            return new Outcome("Saved script '" + s.name() + "' (id " + s.id() + ").",
                    "saved " + s.name(), new Artifact("script", s.id().toString(), s.name()));
        }
    }
}
