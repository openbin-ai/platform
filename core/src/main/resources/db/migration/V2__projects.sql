CREATE TABLE projects (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    original_filename TEXT NOT NULL,
    size_bytes BIGINT NOT NULL,
    sha256 TEXT NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('UPLOADED', 'DECOMPILING', 'READY', 'FAILED')),
    error_message TEXT,
    package_name TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    decompiled_at TIMESTAMPTZ
);

CREATE INDEX idx_projects_user_created ON projects (user_id, created_at DESC);
CREATE INDEX idx_projects_user_sha ON projects (user_id, sha256);
