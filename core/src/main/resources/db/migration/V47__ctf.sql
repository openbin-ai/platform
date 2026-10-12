-- Weekly CTF: one challenge at a time, flag kept as a salted hash, solves
-- ranked by arrival. team_id is reserved for a later teams feature so the
-- history never needs a backfill.

CREATE TABLE ctf_challenges (
    id           UUID PRIMARY KEY,
    slug         TEXT NOT NULL UNIQUE,
    title        TEXT NOT NULL,
    description  TEXT NOT NULL DEFAULT '',
    kind         TEXT NOT NULL,                                   -- BIN | APK
    project_id   UUID REFERENCES projects(id) ON DELETE SET NULL, -- public project holding the binary
    created_by   UUID NOT NULL REFERENCES users(id),
    flag_hash    TEXT NOT NULL,                                   -- sha256(salt ':' flag)
    flag_salt    TEXT NOT NULL,
    flag_hint    TEXT,                                            -- e.g. openbin{...}
    starts_at    TIMESTAMPTZ NOT NULL,
    ends_at      TIMESTAMPTZ NOT NULL,
    season       TEXT NOT NULL,                                   -- e.g. 2026-Q4, from starts_at
    announced_at TIMESTAMPTZ,                                     -- Discord "now live" sent
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    CHECK (ends_at > starts_at)
);
CREATE INDEX ctf_challenges_starts_idx ON ctf_challenges (starts_at DESC);

CREATE TABLE ctf_solves (
    id                 UUID PRIMARY KEY,
    challenge_id       UUID NOT NULL REFERENCES ctf_challenges(id) ON DELETE CASCADE,
    user_id            UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    team_id            UUID,
    solved_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    rank               INT NOT NULL,          -- 1 = first blood; 0 = solved after the window closed
    points             INT NOT NULL,
    ai_assisted        BOOLEAN NOT NULL DEFAULT false,
    writeup_project_id UUID REFERENCES projects(id) ON DELETE SET NULL,
    UNIQUE (challenge_id, user_id)
);
CREATE INDEX ctf_solves_user_idx ON ctf_solves (user_id);
CREATE INDEX ctf_solves_challenge_rank_idx ON ctf_solves (challenge_id, rank, solved_at);

-- Every attempt, correct or not, for rate limiting and stats. The attempted
-- text is never stored.
CREATE TABLE ctf_submissions (
    id           UUID PRIMARY KEY,
    challenge_id UUID NOT NULL REFERENCES ctf_challenges(id) ON DELETE CASCADE,
    user_id      UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    submitted_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    correct      BOOLEAN NOT NULL
);
CREATE INDEX ctf_submissions_user_time_idx ON ctf_submissions (user_id, submitted_at DESC);
