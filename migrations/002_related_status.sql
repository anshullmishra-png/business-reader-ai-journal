-- 002: track background generation of related reading per session.
ALTER TABLE sessions ADD COLUMN related_status TEXT NOT NULL DEFAULT 'none'
  CHECK (related_status IN ('none', 'pending', 'ready', 'failed'));
