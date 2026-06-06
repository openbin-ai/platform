package ai.openapk.core.dbschema;

import ai.openapk.core.auth.User;
import ai.openapk.core.dbschema.dto.DbSchema;
import ai.openapk.core.dbschema.dto.TableColumn;
import ai.openapk.core.dbschema.dto.TableSchema;
import ai.openapk.core.projects.Project;
import ai.openapk.core.projects.ProjectAccessGuard;
import ai.openapk.core.projects.storage.ProjectStorage;
import ai.openapk.core.renames.RenameService;
import ai.openapk.core.util.SdkPaths;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.io.IOException;
import java.nio.charset.MalformedInputException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.Iterator;
import java.util.List;
import java.util.UUID;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import java.util.stream.Stream;

/**
 * Detects two common local-storage patterns in the decompiled tree:
 *
 * <ul>
 *   <li><b>SQLite</b>: classes extending {@code SQLiteOpenHelper}. Table
 *       schemas are mined from {@code CREATE TABLE …(…)} string literals
 *       anywhere in the class body. Works on raw SQL the helper feeds to
 *       {@code db.execSQL(...)}, even if the SQL is split across many
 *       concatenated string fragments — we join all literals first.</li>
 *   <li><b>Room</b>: classes annotated {@code @Entity}. The simple class
 *       name becomes the table (Room's default behaviour); declared fields
 *       become columns.</li>
 * </ul>
 *
 * Coarse and regex-based. Misses dynamic SQL building, ALTER TABLE migrations,
 * and tables defined outside the helper class.
 */
@Service
public class DbSchemaService {

    private static final Logger log = LoggerFactory.getLogger(DbSchemaService.class);

    private static final int MAX_FILES = 30_000;
    private static final long MAX_FILE_BYTES = 1024 * 1024;

    private static final Pattern SQLITE_HELPER_CLASS = Pattern.compile(
            "(?:public|private|protected|abstract|final|static|\\s)*class\\s+(\\w+)\\s+extends\\s+\\w*SQLiteOpenHelper\\b"
    );
    // Capture CREATE TABLE [IF NOT EXISTS] name ( ... )
    private static final Pattern CREATE_TABLE = Pattern.compile(
            "CREATE\\s+TABLE(?:\\s+IF\\s+NOT\\s+EXISTS)?\\s+\"?(\\w+)\"?\\s*\\(([^;]*?)\\)",
            Pattern.CASE_INSENSITIVE | Pattern.DOTALL
    );
    // Pull any double-quoted string literal in Java source for SQL-joining.
    private static final Pattern JAVA_STRING_LITERAL = Pattern.compile("\"([^\"\\\\]*(?:\\\\.[^\"\\\\]*)*)\"");

    private static final Pattern ENTITY_CLASS = Pattern.compile(
            "@Entity\\b[^\\n]*[\\s\\S]{0,400}?\\bclass\\s+(\\w+)"
    );
    // Field declaration: optional modifiers + type + name + (`;` or `=`).
    // Skip the @ColumnInfo / @PrimaryKey lines (those are annotations, not declarations).
    private static final Pattern ROOM_FIELD = Pattern.compile(
            "^\\s*(?:public|private|protected)?\\s*(?:final\\s+|static\\s+|transient\\s+|volatile\\s+)*" +
            "([\\w<>\\[\\]?,.\\s$]+?)\\s+(\\w+)\\s*(?:=[^;]*)?;",
            Pattern.MULTILINE
    );

    private final ProjectAccessGuard guard;
    private final ProjectStorage storage;
    private final RenameService renameService;

    public DbSchemaService(
            ProjectAccessGuard guard,
            ProjectStorage storage,
            RenameService renameService
    ) {
        this.guard = guard;
        this.storage = storage;
        this.renameService = renameService;
    }

    @Transactional(readOnly = true)
    public List<DbSchema> scan(User user, UUID projectId, boolean includeSdks) {
        // VIEWER-OK: schema scan is read-only.
        Project project = guard.requireRead(user, projectId);
        Path root = storage.srcDir(project.getUser().getId(), projectId).normalize();
        if (!Files.isDirectory(root)) return List.of();

        List<DbSchema> out = new ArrayList<>();
        try (Stream<Path> walk = Files.walk(root)) {
            Iterator<Path> iter = walk.filter(Files::isRegularFile)
                    .filter(p -> p.getFileName().toString().endsWith(".java"))
                    .filter(p -> includeSdks || !SdkPaths.isSdkPath(root.relativize(p).toString()))
                    .limit(MAX_FILES)
                    .iterator();
            while (iter.hasNext()) {
                Path p = iter.next();
                String rel = root.relativize(p).toString().replace('\\', '/');
                try {
                    if (Files.size(p) > MAX_FILE_BYTES) continue;
                    String content = Files.readString(p, StandardCharsets.UTF_8);
                    content = renameService.applyMapToContent(projectId, content);
                    scanForSqlite(rel, content, out);
                    scanForRoom(rel, content, out);
                } catch (MalformedInputException e) {
                    // skip
                } catch (IOException e) {
                    log.debug("dbschema scan unreadable {}: {}", p, e.toString());
                }
            }
        } catch (IOException e) {
            log.warn("dbschema walk failed: {}", e.toString());
        }
        return out;
    }

    private static void scanForSqlite(String rel, String content, List<DbSchema> out) {
        Matcher cls = SQLITE_HELPER_CLASS.matcher(content);
        if (!cls.find()) return;
        String className = cls.group(1);
        int classLine = lineOf(content, cls.start());

        // Join all string literals in the file — SQLite SQL is often built
        // by concatenating many small "..." fragments per column.
        StringBuilder joined = new StringBuilder();
        Matcher lit = JAVA_STRING_LITERAL.matcher(content);
        while (lit.find()) {
            joined.append(unescapeJava(lit.group(1))).append(' ');
        }
        String sql = joined.toString();

        List<TableSchema> tables = new ArrayList<>();
        Matcher t = CREATE_TABLE.matcher(sql);
        while (t.find()) {
            String tableName = t.group(1);
            List<TableColumn> cols = parseColumns(t.group(2));
            tables.add(new TableSchema(tableName, cols));
        }
        if (!tables.isEmpty()) {
            out.add(new DbSchema("sqlite", className, rel, classLine, tables));
        }
    }

    private static void scanForRoom(String rel, String content, List<DbSchema> out) {
        Matcher cls = ENTITY_CLASS.matcher(content);
        if (!cls.find()) return;
        String className = cls.group(1);
        int classLine = lineOf(content, cls.start());

        // Naïvely take all field-shaped declarations following the class
        // keyword. Misses some Kotlin/Java oddities but covers typical Room entities.
        int classStart = content.indexOf("class " + className);
        if (classStart < 0) return;
        int bodyStart = content.indexOf('{', classStart);
        if (bodyStart < 0) return;
        int bodyEnd = matchingBrace(content, bodyStart);
        if (bodyEnd < 0) bodyEnd = content.length();
        String body = content.substring(bodyStart + 1, bodyEnd);

        List<TableColumn> cols = new ArrayList<>();
        Matcher f = ROOM_FIELD.matcher(body);
        while (f.find()) {
            String type = f.group(1).trim();
            String name = f.group(2);
            // Skip method-body local-looking matches like `return x;` — heuristic
            if (name.equals("return") || name.equals("new")) continue;
            cols.add(new TableColumn(name, type, ""));
        }
        if (cols.isEmpty()) return;
        out.add(new DbSchema("room", className, rel, classLine,
                List.of(new TableSchema(className, cols))));
    }

    /**
     * Parse the column list inside a CREATE TABLE (…) clause. Splits on
     * top-level commas (ignoring those inside parentheses), then takes the
     * first token as the column name and the rest as type + constraints.
     */
    private static List<TableColumn> parseColumns(String inside) {
        List<TableColumn> cols = new ArrayList<>();
        List<String> parts = splitTopLevelCommas(inside);
        for (String part : parts) {
            String trimmed = part.trim();
            if (trimmed.isEmpty()) continue;
            // Skip table-level constraints like "PRIMARY KEY (a, b)" or "FOREIGN KEY ..."
            String upper = trimmed.toUpperCase();
            if (upper.startsWith("PRIMARY KEY") || upper.startsWith("FOREIGN KEY")
                    || upper.startsWith("UNIQUE ") || upper.startsWith("CHECK ")
                    || upper.startsWith("CONSTRAINT ")) continue;
            String[] toks = trimmed.split("\\s+", 3);
            String name = stripQuotes(toks[0]);
            String type = toks.length > 1 ? toks[1] : "";
            String cons = toks.length > 2 ? toks[2] : "";
            cols.add(new TableColumn(name, type, cons));
        }
        return cols;
    }

    private static List<String> splitTopLevelCommas(String s) {
        List<String> out = new ArrayList<>();
        int depth = 0;
        StringBuilder cur = new StringBuilder();
        for (int i = 0; i < s.length(); i++) {
            char c = s.charAt(i);
            if (c == '(') depth++;
            else if (c == ')') depth--;
            if (c == ',' && depth == 0) {
                out.add(cur.toString());
                cur.setLength(0);
            } else {
                cur.append(c);
            }
        }
        if (cur.length() > 0) out.add(cur.toString());
        return out;
    }

    private static int matchingBrace(String s, int openIdx) {
        int depth = 0;
        for (int i = openIdx; i < s.length(); i++) {
            char c = s.charAt(i);
            if (c == '{') depth++;
            else if (c == '}') { depth--; if (depth == 0) return i; }
        }
        return -1;
    }

    private static int lineOf(String s, int charIdx) {
        int line = 1;
        for (int i = 0; i < charIdx && i < s.length(); i++) {
            if (s.charAt(i) == '\n') line++;
        }
        return line;
    }

    private static String stripQuotes(String s) {
        if (s.length() >= 2) {
            char first = s.charAt(0), last = s.charAt(s.length() - 1);
            if ((first == '"' && last == '"') || (first == '`' && last == '`')) {
                return s.substring(1, s.length() - 1);
            }
        }
        return s;
    }

    private static String unescapeJava(String s) {
        return s.replace("\\n", "\n").replace("\\t", "\t").replace("\\\"", "\"").replace("\\\\", "\\");
    }
}
