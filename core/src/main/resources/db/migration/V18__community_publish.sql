-- Community visibility for project reports. Distinct from `published_at`
-- (which means "report is finalized / read-only"): community_published_at
-- governs whether the report shows up in the anonymous /community feed.
--
-- We could have overloaded `published_at` but they're separate concerns —
-- a user can finalize a report without making it public, and (later) we
-- may allow unpublishing from the community without de-finalizing the
-- report. Keeping the columns separate avoids a future migration to split
-- them back apart.
ALTER TABLE project_reports ADD COLUMN community_published_at TIMESTAMPTZ NULL;

-- Hot path: community feed query is
--   SELECT ... WHERE community_published_at IS NOT NULL
--   ORDER BY community_published_at DESC
-- A partial DESC index keeps the index tiny (only published rows) and
-- ordered to match the feed sort direction.
CREATE INDEX project_reports_community_published_idx
    ON project_reports (community_published_at DESC)
    WHERE community_published_at IS NOT NULL;
