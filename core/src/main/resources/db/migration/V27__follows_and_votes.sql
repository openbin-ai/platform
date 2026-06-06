-- Social layer on top of community-published reports: directional follows
-- between users and per-user upvotes on individual reports. Two small
-- tables; the heavy work happens in joins from the community feed query
-- (vote_count via aggregate, "is following this author" / "did I upvote
-- this" via correlated subselect against the current viewer).
--
-- No downvotes by design: the value signal for a research community is
-- "this is worth reading", not "this is bad". The latter is what the
-- existing abuse-report flow is for.

CREATE TABLE follows (
    follower_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    followee_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (follower_id, followee_id),
    -- Hard rule, not a service-layer check: a user cannot follow themselves.
    -- Anything that tries (a bug in our code or a malicious caller) fails
    -- at the DB rather than producing a self-loop the feed query would
    -- then have to filter out.
    CHECK (follower_id <> followee_id)
);

-- "Who do I follow?" — the personal home feed reads this first to expand
-- into the set of followee_ids, then joins project_reports filtered by
-- author. Composite index ordered by created_at so the followee roster
-- on a profile page can paginate without an extra sort.
CREATE INDEX idx_follows_follower ON follows (follower_id, created_at DESC);

-- "Who follows me?" — drives the follower count on the public profile and
-- (later) a notifications surface for "X started following you".
CREATE INDEX idx_follows_followee ON follows (followee_id, created_at DESC);


CREATE TABLE report_votes (
    user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    report_id  UUID NOT NULL REFERENCES project_reports(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (user_id, report_id)
);

-- Aggregate path: "how many upvotes does this report have?" The feed
-- query LEFT JOINs against a GROUP BY on report_id; an index keyed by
-- report_id keeps that scan tight.
CREATE INDEX idx_report_votes_report ON report_votes (report_id);
