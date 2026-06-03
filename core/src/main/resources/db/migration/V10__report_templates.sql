-- User-owned named templates of report section sets. Apply to a project's
-- report to reset its sections list to the template's. Mode is informational
-- only: a MALWARE template can still be applied to a VULN_RESEARCH project,
-- but the UI filters by mode by default to keep the picker focused.
CREATE TABLE report_templates (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    description TEXT,
    mode VARCHAR(32) NOT NULL CHECK (mode IN ('MALWARE', 'VULN_RESEARCH', 'ANY')),
    sections_jsonb JSONB NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (user_id, name)
);

CREATE INDEX report_templates_user_id_idx ON report_templates (user_id);
