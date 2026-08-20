-- Blog posts: standalone writing that isn't tied to a project.
--
-- People were publishing essays by uploading them as SCRIPT projects, which
-- is a terrible fit: it burns a worker run, files land in an analysis view,
-- and the thing shows up in the community feed as malware analysis.
--
-- A blog post cannot be a report. project_reports.project_id is NOT NULL
-- UNIQUE and every community/feed query joins projects for kind + name, so
-- making it nullable would rewrite the most-trafficked queries in the app.
-- Separate table, own lifecycle.

CREATE TABLE blog_posts (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    author_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    title        TEXT NOT NULL,
    -- Stable public identifier. Generated from the title at first publish and
    -- then frozen: a slug that moves breaks every link to the post.
    slug         TEXT NOT NULL UNIQUE,
    -- Optional teaser for the feed card. Falls back to a body excerpt.
    summary      TEXT,
    body_md      TEXT NOT NULL,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    -- NULL = draft, visible only to its author.
    published_at TIMESTAMPTZ
);

-- "This author's posts, newest first" — the profile page.
CREATE INDEX idx_blog_posts_author ON blog_posts (author_id, created_at DESC);

-- The public feed. Partial so drafts stay out of the index entirely.
CREATE INDEX idx_blog_posts_published ON blog_posts (published_at DESC)
    WHERE published_at IS NOT NULL;

-- Upvotes get their own table rather than a nullable column on report_votes:
-- that table's primary key is (user_id, report_id) and a PK column can't be
-- nullable. Vote logic is an insert, a delete and a COUNT, so the duplication
-- is cheap — unlike comments below, where threading, soft-deletes and
-- notifications are worth keeping in exactly one place.
CREATE TABLE post_votes (
    user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    post_id    UUID NOT NULL REFERENCES blog_posts(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (user_id, post_id)
);

CREATE INDEX idx_post_votes_post ON post_votes (post_id);

-- Comments generalize in place. report_comments has a surrogate id, so the
-- target can become "exactly one of report_id / post_id" without touching a
-- key. Every existing query filters `report_id = ?` and is unaffected.
ALTER TABLE report_comments ALTER COLUMN report_id DROP NOT NULL;

ALTER TABLE report_comments
    ADD COLUMN post_id UUID REFERENCES blog_posts(id) ON DELETE CASCADE;

ALTER TABLE report_comments
    ADD CONSTRAINT ck_report_comments_one_target
    CHECK (num_nonnulls(report_id, post_id) = 1);

CREATE INDEX idx_report_comments_post ON report_comments (post_id, created_at)
    WHERE post_id IS NOT NULL;

-- Author identity. Researchers want to be findable off-platform, and a byline
-- with no way to follow the person is a dead end.
--
-- Handles (github/x) are stored bare, WITHOUT the @ or a URL, and the
-- frontend builds the link — so a stored value can never carry its own
-- scheme. The two free URL fields are validated as http(s) at the API
-- boundary for the same reason.
ALTER TABLE users
    ADD COLUMN bio          TEXT,
    ADD COLUMN website_url  TEXT,
    ADD COLUMN github_user  TEXT,
    ADD COLUMN x_user       TEXT,
    ADD COLUMN mastodon_url TEXT,
    ADD COLUMN linkedin_url TEXT;
