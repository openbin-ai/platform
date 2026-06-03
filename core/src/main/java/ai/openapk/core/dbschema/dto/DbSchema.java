package ai.openapk.core.dbschema.dto;

import java.util.List;

/**
 * A detected local-storage schema. {@code kind} is "sqlite" for
 * SQLiteOpenHelper subclasses (tables extracted from CREATE TABLE strings
 * in the source), or "room" for {@code @Entity}-annotated classes (one
 * table per entity, columns from declared fields).
 */
public record DbSchema(
        String kind,
        String className,
        String file,
        int line,
        List<TableSchema> tables
) {}
