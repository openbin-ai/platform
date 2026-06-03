-- Community taxonomy + search for project reports.
--
-- malware_type uses the STIX 2.1 `malware-type` open vocabulary (ransomware,
-- trojan, backdoor, dropper, rootkit, wiper, worm, spyware, keylogger,
-- remote-access-trojan, downloader, screen-capture, webshell, virus,
-- exploit-kit, adware, botnet, bot, rogue-security-software, bootkit,
-- resource-exploitation, unknown). Stored as plain TEXT — enforcing the
-- enum at the app layer keeps the migration cheap to evolve later.
--
-- tags is a free-form Postgres TEXT[]. App enforces caps (max 8 tags per
-- report, max 32 chars per tag) so we don't need CHECK constraints here.
ALTER TABLE project_reports ADD COLUMN malware_type TEXT NULL;
ALTER TABLE project_reports ADD COLUMN tags TEXT[] NOT NULL DEFAULT '{}';

-- Full-text search column. We cannot use GENERATED ALWAYS ... STORED here:
-- Postgres marks to_tsvector('english', ...) as STABLE (the dictionaries
-- backing a config can change at runtime), and STORED generated columns
-- require IMMUTABLE expressions. The workaround is a regular column plus
-- a BEFORE INSERT OR UPDATE trigger that fills it from the row data —
-- functionally identical from the query side, just slightly more SQL.
ALTER TABLE project_reports ADD COLUMN search_tsv tsvector;

CREATE OR REPLACE FUNCTION project_reports_search_tsv_refresh()
RETURNS trigger AS $$
BEGIN
    NEW.search_tsv :=
        setweight(to_tsvector('english', coalesce(NEW.title, '')), 'A') ||
        setweight(to_tsvector('english', array_to_string(coalesce(NEW.tags, '{}'::text[]), ' ')), 'B') ||
        setweight(to_tsvector('english', coalesce(NEW.malware_type, '')), 'B') ||
        setweight(to_tsvector('english', coalesce(NEW.sections_jsonb::text, '')), 'D');
    RETURN NEW;
END
$$ LANGUAGE plpgsql;

CREATE TRIGGER project_reports_search_tsv_trg
    BEFORE INSERT OR UPDATE OF title, tags, malware_type, sections_jsonb
    ON project_reports
    FOR EACH ROW
    EXECUTE FUNCTION project_reports_search_tsv_refresh();

-- Backfill any pre-existing rows so the index covers them too. New rows
-- get populated by the trigger automatically.
UPDATE project_reports SET title = title;

-- GIN is the right index for tsvector. Only meaningful for community
-- queries (no point indexing private rows) — partial index on the same
-- predicate as the feed index keeps it small.
CREATE INDEX project_reports_search_tsv_idx
    ON project_reports USING GIN (search_tsv)
    WHERE community_published_at IS NOT NULL;

-- tags also gets its own GIN for the chip-filter case (WHERE tags && ARRAY['ransomware']).
CREATE INDEX project_reports_tags_idx
    ON project_reports USING GIN (tags)
    WHERE community_published_at IS NOT NULL;

-- malware_type filter is btree — single column equality, low cardinality.
CREATE INDEX project_reports_malware_type_idx
    ON project_reports (malware_type)
    WHERE community_published_at IS NOT NULL AND malware_type IS NOT NULL;
