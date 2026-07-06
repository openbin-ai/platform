-- Contributor byline (Phase A). Turns single-author reports into a credited
-- team: the owner is LEAD, and everyone who materially worked the project
-- (applied renames, pinned highlights, edited the report) is a CONTRIBUTOR.
--
-- Prerequisite attribution columns: project_renames and project_reports never
-- recorded WHO made a change (single-user origin). project_highlights.created_by
-- already exists (V32). We add the two missing author columns here, mirroring
-- that SET-NULL precedent so a contribution survives the author leaving.

ALTER TABLE project_renames
    ADD COLUMN applied_by UUID REFERENCES users(id) ON DELETE SET NULL;

ALTER TABLE project_reports
    ADD COLUMN updated_by UUID REFERENCES users(id) ON DELETE SET NULL;

-- Global "don't publicly credit me" opt-out. A user's contributions still
-- count internally, but they're omitted from the public byline. The project
-- OWNER is exempt (publishing to the community feed is their explicit act and
-- they're already exposed as the report's author).
ALTER TABLE users
    ADD COLUMN credit_publicly BOOLEAN NOT NULL DEFAULT TRUE;

-- The byline snapshot, frozen at publish time so later roster/name changes
-- don't silently rewrite a published report's credits (owner re-curates +
-- republishes to update). display_name / email_md5 are snapshotted so the
-- credit renders stably even if the account is later renamed or deleted.
CREATE TABLE report_contributors (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    report_id     UUID NOT NULL REFERENCES project_reports(id) ON DELETE CASCADE,
    user_id       UUID REFERENCES users(id) ON DELETE SET NULL,
    credit        TEXT NOT NULL CHECK (credit IN ('LEAD', 'CONTRIBUTOR')),
    display_name  TEXT,
    email_md5     VARCHAR(32),
    position      INT NOT NULL DEFAULT 0,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    -- One credit row per user per report; the snapshot rebuild upserts on this.
    CONSTRAINT report_contributors_report_user UNIQUE (report_id, user_id)
);

CREATE INDEX idx_report_contributors_report
    ON report_contributors (report_id, position);

CREATE INDEX idx_report_contributors_user
    ON report_contributors (user_id) WHERE user_id IS NOT NULL;
