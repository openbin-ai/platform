package ai.openapk.core.dbschema.dto;

public record TableColumn(
        String name,
        String type,
        String constraints  // raw modifier list, e.g. "PRIMARY KEY AUTOINCREMENT NOT NULL"
) {}
