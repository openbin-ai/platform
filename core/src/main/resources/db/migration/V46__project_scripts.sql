-- Scripts saved on a project: decryptors, extractors, IOC pullers, written
-- by BINNY light or pasted by an analyst. Until now generated scripts were
-- only ever returned inline (and kept in the browser's localStorage), so a
-- teammate could not see them and a reload could lose them.
--
-- `content` is TEXT: a script is a few KB, hard-capped at write time, so it
-- sits next to its project row like script_deobfuscations.source does.
-- Nothing here is ever executed server-side; the platform stores and shows
-- scripts, the analyst runs them.
CREATE TABLE project_scripts (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id  UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    name        VARCHAR(200) NOT NULL,
    language    VARCHAR(32) NOT NULL,
    description TEXT,
    content     TEXT NOT NULL,
    -- Where the script came from: a function name, a file path, or null.
    source_ref  VARCHAR(512),
    created_by  UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_project_scripts_project ON project_scripts (project_id, created_at DESC);
