-- Bundles (multi-binary grouping). A bundle is a lightweight wrapper that
-- groups several standalone BIN projects that belong to one real-world sample
-- (e.g. a dropper + its payloads, or the several .so ABIs of one app). Each
-- member stays its OWN project row — dedup / fork / publish / annotations are
-- unchanged and per-project. The bundle only records "these N projects are one
-- thing" plus an editable display name.
--
-- Bundle creation is CLI-only in v1 (openbin decompile ./dir  /  --bundle NAME);
-- the web app lists, opens, renames, and deletes bundles but does not create
-- them.

CREATE TABLE bundles (
    id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name       TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_bundles_user
    ON bundles (user_id, created_at DESC);

-- Nullable grouping pointer on projects. Existing rows keep bundle_id NULL —
-- zero migration, every current project stays a standalone top-level entry.
--
-- ON DELETE SET NULL (not CASCADE): the DB never destroys member projects when
-- a bundle row disappears. Deleting a bundle removes its members EXPLICITLY in
-- BundleService (so per-project storage + shared-blob refcount cleanup runs);
-- SET NULL is only a safety fallback so a stray bundle-row delete degrades to
-- "ungroup" rather than silently dropping analyses.
ALTER TABLE projects
    ADD COLUMN bundle_id UUID REFERENCES bundles(id) ON DELETE SET NULL;

CREATE INDEX idx_projects_bundle
    ON projects (bundle_id)
    WHERE bundle_id IS NOT NULL;
