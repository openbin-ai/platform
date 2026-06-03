-- AI-generated deobfuscation of obfuscated decompiler output (control-flow
-- flattening, opaque predicates, dispatcher state machines, etc.). Each
-- row stores the cleaned version of one function alongside the model that
-- produced it and the token cost. Stored separately from the analysis JSON
-- so chain/xref/network/rename indexers continue to operate against the
-- original — deobf is a view-layer concern only.
--
-- {@code original_name} is the function name as it appears in the analysis
-- JSON (pre-rename); RenameService.resolveOriginal is used to look up the
-- row when the user sends a renamed name. UNIQUE on (project_id,
-- original_name) so re-generating just overwrites the previous attempt.
CREATE TABLE function_deobfuscations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    original_name TEXT NOT NULL,
    deobfuscated TEXT NOT NULL,
    explanation TEXT,
    model TEXT NOT NULL,
    input_tokens INT NOT NULL,
    output_tokens INT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (project_id, original_name)
);

CREATE INDEX idx_function_deobfuscations_project ON function_deobfuscations(project_id);
