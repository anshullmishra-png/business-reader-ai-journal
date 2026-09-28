-- 001_init: full schema for Business Reads Journal.
-- Timestamps are ISO-8601 UTC strings (e.g. 2026-09-28T09:15:00.000Z).
-- JSON columns hold text validated by zod on the server.

CREATE TABLE settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE sessions (
  id                          INTEGER PRIMARY KEY,
  url                         TEXT,
  source                      TEXT NOT NULL DEFAULT 'other'
                                CHECK (source IN ('the_ken', 'the_arc', 'entrackr', 'other')),
  title                       TEXT NOT NULL,
  author                      TEXT,
  published_at                TEXT,
  article_text                TEXT NOT NULL,
  word_count                  INTEGER NOT NULL DEFAULT 0,
  tags                        TEXT,                       -- JSON: companies, sector, business_model, stage, geography, themes
  tags_status                 TEXT NOT NULL DEFAULT 'pending'
                                CHECK (tags_status IN ('pending', 'ready', 'failed')),
  stage                       TEXT NOT NULL DEFAULT 'write'
                                CHECK (stage IN ('write', 'explore', 'interview', 'verdict')),
  comprehension_text          TEXT,
  comprehension_seconds       INTEGER,
  comprehension_submitted_at  TEXT,
  comprehension_eval          TEXT,                       -- JSON: 5 scored dimensions
  comprehension_score         REAL,
  interview_score             REAL,
  overall_score               REAL,
  verdict                     TEXT,                       -- JSON: summary + "work on this next"
  created_at                  TEXT NOT NULL,
  updated_at                  TEXT NOT NULL
);
CREATE INDEX idx_sessions_created_at ON sessions (created_at);
CREATE INDEX idx_sessions_source ON sessions (source);

CREATE TABLE related_items (
  id          INTEGER PRIMARY KEY,
  session_id  INTEGER NOT NULL REFERENCES sessions (id) ON DELETE CASCADE,
  position    INTEGER NOT NULL,
  title       TEXT NOT NULL,
  category    TEXT NOT NULL,
  why         TEXT NOT NULL,
  queries     TEXT NOT NULL,                              -- JSON array of search query strings
  done        INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX idx_related_items_session ON related_items (session_id);

CREATE TABLE question_sets (
  id                  INTEGER PRIMARY KEY,
  session_id          INTEGER NOT NULL REFERENCES sessions (id) ON DELETE CASCADE,
  kind                TEXT NOT NULL CHECK (kind IN ('main', 'extra')),
  level               TEXT CHECK (level IN ('easy', 'medium', 'hard', 'super_hard')),  -- extra rounds only
  difficulty_at_time  INTEGER NOT NULL,
  gen_status          TEXT NOT NULL DEFAULT 'pending'
                        CHECK (gen_status IN ('pending', 'ready', 'failed')),
  status              TEXT NOT NULL DEFAULT 'not_started'
                        CHECK (status IN ('not_started', 'in_progress', 'answered', 'evaluated')),
  eval_status         TEXT CHECK (eval_status IN ('pending', 'ready', 'failed')),
  score               REAL,
  timeouts            INTEGER,
  avg_seconds         REAL,
  started_at          TEXT,
  completed_at        TEXT,
  created_at          TEXT NOT NULL
);
CREATE INDEX idx_question_sets_session ON question_sets (session_id);
CREATE INDEX idx_question_sets_created_at ON question_sets (created_at);

CREATE TABLE questions (
  id              INTEGER PRIMARY KEY,
  set_id          INTEGER NOT NULL REFERENCES question_sets (id) ON DELETE CASCADE,
  position        INTEGER NOT NULL,
  type            TEXT NOT NULL CHECK (type IN ('mcq', 'short', 'structured', 'estimation')),
  framework       TEXT NOT NULL,
  prompt          TEXT NOT NULL,
  options         TEXT,                                   -- JSON array, MCQ only
  correct_option  INTEGER,                                -- 0-based index, MCQ only
  cross_article   INTEGER NOT NULL DEFAULT 0,
  started_at      TEXT,                                   -- server-side clock for the timer
  user_answer     TEXT,
  seconds_used    INTEGER,
  timed_out       INTEGER NOT NULL DEFAULT 0,
  answered_at     TEXT,
  score           REAL,
  feedback        TEXT,
  model_answer    TEXT,
  UNIQUE (set_id, position)
);
CREATE INDEX idx_questions_set ON questions (set_id);
CREATE INDEX idx_questions_framework ON questions (framework);

CREATE TABLE glossary_terms (
  id                INTEGER PRIMARY KEY,
  term_normalized   TEXT NOT NULL UNIQUE,
  display_term      TEXT NOT NULL,
  entry             TEXT NOT NULL,                        -- JSON: definition, formula, examples, why, related
  extra_examples    TEXT,                                 -- JSON array appended by "More examples"
  sector            TEXT,
  lookup_count      INTEGER NOT NULL DEFAULT 1,
  first_session_id  INTEGER REFERENCES sessions (id) ON DELETE SET NULL,
  leitner_box       INTEGER NOT NULL DEFAULT 1 CHECK (leitner_box BETWEEN 1 AND 5),
  last_reviewed_at  TEXT,
  created_at        TEXT NOT NULL
);
CREATE INDEX idx_glossary_terms_created_at ON glossary_terms (created_at);

CREATE TABLE glossary_lookups (
  id          INTEGER PRIMARY KEY,
  term_id     INTEGER NOT NULL REFERENCES glossary_terms (id) ON DELETE CASCADE,
  session_id  INTEGER REFERENCES sessions (id) ON DELETE SET NULL,
  created_at  TEXT NOT NULL
);
CREATE INDEX idx_glossary_lookups_term ON glossary_lookups (term_id);
CREATE INDEX idx_glossary_lookups_created_at ON glossary_lookups (created_at);

CREATE TABLE difficulty_history (
  id          INTEGER PRIMARY KEY,
  level       INTEGER NOT NULL CHECK (level BETWEEN 1 AND 10),
  session_id  INTEGER REFERENCES sessions (id) ON DELETE SET NULL,
  created_at  TEXT NOT NULL
);
CREATE INDEX idx_difficulty_history_created_at ON difficulty_history (created_at);

CREATE TABLE weekly_reviews (
  id            INTEGER PRIMARY KEY,
  period_start  TEXT NOT NULL,
  period_end    TEXT NOT NULL,
  session_ids   TEXT NOT NULL,                            -- JSON array
  content       TEXT NOT NULL,                            -- JSON
  created_at    TEXT NOT NULL
);
CREATE INDEX idx_weekly_reviews_created_at ON weekly_reviews (created_at);

CREATE TABLE ai_calls (
  id           INTEGER PRIMARY KEY,
  task         TEXT NOT NULL,
  model        TEXT NOT NULL,
  duration_ms  INTEGER NOT NULL,
  success      INTEGER NOT NULL,
  error        TEXT,
  created_at   TEXT NOT NULL
);
CREATE INDEX idx_ai_calls_created_at ON ai_calls (created_at);

CREATE TABLE jobs (
  id          INTEGER PRIMARY KEY,
  task        TEXT NOT NULL,
  session_id  INTEGER REFERENCES sessions (id) ON DELETE CASCADE,
  set_id      INTEGER REFERENCES question_sets (id) ON DELETE CASCADE,
  payload     TEXT,                                       -- JSON
  status      TEXT NOT NULL DEFAULT 'queued'
                CHECK (status IN ('queued', 'running', 'done', 'failed')),
  attempts    INTEGER NOT NULL DEFAULT 0,
  error       TEXT,
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL
);
CREATE INDEX idx_jobs_status ON jobs (status);
CREATE INDEX idx_jobs_created_at ON jobs (created_at);
