package ai.openapk.core.dbschema.dto;

import java.util.List;

public record TableSchema(
        String name,
        List<TableColumn> columns
) {}
