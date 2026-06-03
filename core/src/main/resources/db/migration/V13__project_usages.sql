-- Persistent reverse-usage index. Built once when JADX completes; queried in
-- ms by SymbolService.findUsages + CallChainService instead of grepping the
-- whole tree on every right-click. For a WhatsApp-sized decompile this is the
-- difference between 5-30s per usage lookup and <100ms.
--
-- One row per (file, line, name) — duplicates on the same line are folded by
-- the indexer. Single-character identifiers are intentionally skipped at
-- indexing time (obfuscated "a"/"b"/"c" identifiers would dominate the table
-- with no useful signal).
CREATE TABLE project_usages (
    id BIGSERIAL PRIMARY KEY,
    project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    file TEXT NOT NULL,
    line INT NOT NULL,
    snippet TEXT NOT NULL,
    -- Enclosing method's "ClassName.methodName(sig)" so CallChainService can
    -- attribute a usage to its caller without a second index lookup. NULL
    -- for usages outside any indexed method body (top-level field inits etc.).
    enclosing_method TEXT,
    -- Pre-computed at index time so SDK filtering is a column read, not a
    -- pattern match per query.
    is_sdk BOOLEAN NOT NULL DEFAULT FALSE,
    -- "method" | "ctor" | "ref" — disambiguates new Foo() from foo() from Foo::bar.
    kind VARCHAR(8) NOT NULL DEFAULT 'method'
);

-- Hot path: WHERE project_id = ? AND name = ?  +  is_sdk filter.
CREATE INDEX project_usages_lookup_idx ON project_usages (project_id, name, is_sdk);

-- For the "true count" / truncation hint without paging through rows.
CREATE INDEX project_usages_project_idx ON project_usages (project_id);
