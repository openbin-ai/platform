package ai.openapk.core.symbols.usages;

import org.springframework.dao.EmptyResultDataAccessException;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;

import java.sql.Types;
import java.util.List;
import java.util.UUID;

/**
 * Thin JdbcTemplate-backed repo for the {@code project_usages} table.
 * Bulk inserts are batched via {@code batchUpdate} — for a WhatsApp-sized
 * decompile this writes 5-10M rows in 1-2 minutes flat.
 */
@Repository
public class ProjectUsageRepository {

    private final JdbcTemplate jdbc;

    public ProjectUsageRepository(JdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    /** Per-batch size — Postgres caps batch inserts around 32k parameters
     *  (we're 7 params per row, so this stays well under the limit). */
    private static final int BATCH_SIZE = 2_000;

    public void bulkInsert(UUID projectId, List<ProjectUsageRow> rows) {
        if (rows.isEmpty()) return;
        String sql = "INSERT INTO project_usages " +
                "(project_id, name, file, line, snippet, enclosing_method, is_sdk, kind) " +
                "VALUES (?, ?, ?, ?, ?, ?, ?, ?)";
        for (int start = 0; start < rows.size(); start += BATCH_SIZE) {
            int end = Math.min(start + BATCH_SIZE, rows.size());
            List<ProjectUsageRow> chunk = rows.subList(start, end);
            jdbc.batchUpdate(sql, chunk, chunk.size(), (ps, row) -> {
                ps.setObject(1, projectId);
                ps.setString(2, row.name());
                ps.setString(3, row.file());
                ps.setInt(4, row.line());
                ps.setString(5, row.snippet());
                if (row.enclosingMethod() == null) ps.setNull(6, Types.VARCHAR);
                else ps.setString(6, row.enclosingMethod());
                ps.setBoolean(7, row.isSdk());
                ps.setString(8, row.kind());
            });
        }
    }

    /**
     * Fast lookup by exact name. Returns at most {@code limit} rows, ordered so
     * non-SDK code comes first (matches the call-chain bias toward user code).
     */
    public List<ProjectUsageRow> findByName(UUID projectId, String name, boolean includeSdks, int limit) {
        String sql = "SELECT name, file, line, snippet, enclosing_method, is_sdk, kind " +
                "FROM project_usages " +
                "WHERE project_id = ? AND name = ?" +
                (includeSdks ? "" : " AND is_sdk = FALSE") +
                " ORDER BY is_sdk ASC, file ASC, line ASC " +
                "LIMIT ?";
        return jdbc.query(sql, (rs, i) -> new ProjectUsageRow(
                rs.getString("name"),
                rs.getString("file"),
                rs.getInt("line"),
                rs.getString("snippet"),
                rs.getString("enclosing_method"),
                rs.getBoolean("is_sdk"),
                rs.getString("kind")
        ), projectId, name, limit);
    }

    /** True count of usages for this name, ignoring any LIMIT. Powers the
     *  "showing N of M" truncation hint in the call-chain UI. */
    public long countByName(UUID projectId, String name, boolean includeSdks) {
        String sql = "SELECT COUNT(*) FROM project_usages " +
                "WHERE project_id = ? AND name = ?" +
                (includeSdks ? "" : " AND is_sdk = FALSE");
        try {
            Long n = jdbc.queryForObject(sql, Long.class, projectId, name);
            return n == null ? 0 : n;
        } catch (EmptyResultDataAccessException e) {
            return 0;
        }
    }

    /** Did the indexer ever run for this project? Lets findUsages fall back
     *  to live-grep gracefully for legacy projects from before V13. */
    public boolean hasAnyRows(UUID projectId) {
        Long n = jdbc.queryForObject(
                "SELECT COUNT(*) FROM project_usages WHERE project_id = ? LIMIT 1",
                Long.class, projectId);
        return n != null && n > 0;
    }

    /** Wipe the index for a project — used when we re-decompile so the next
     *  indexer run starts from a clean slate. */
    public int deleteByProjectId(UUID projectId) {
        return jdbc.update("DELETE FROM project_usages WHERE project_id = ?", projectId);
    }
}
