// Versioned migrations, kept in JS so they ship inside the Vercel function.
// Append new entries; never edit an applied one.
// Timestamps are ISO-8601 UTC strings. JSON columns hold text validated by zod.

export const MIGRATIONS = [
  {
    name: '001_init',
    sql: `
CREATE TABLE users (
  id                INTEGER PRIMARY KEY,
  email             TEXT NOT NULL UNIQUE,
  name              TEXT NOT NULL,
  password_hash     TEXT NOT NULL,
  timer_seconds     INTEGER NOT NULL DEFAULT 60,
  template_default  INTEGER NOT NULL DEFAULT 0,
  difficulty_level  INTEGER NOT NULL DEFAULT 3,
  capture_token     TEXT NOT NULL UNIQUE,
  extension_origin  TEXT,
  created_at        TEXT NOT NULL
);

CREATE TABLE auth_sessions (
  id          INTEGER PRIMARY KEY,
  user_id     INTEGER NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  token_hash  TEXT NOT NULL UNIQUE,
  created_at  TEXT NOT NULL,
  expires_at  TEXT NOT NULL
);
CREATE INDEX idx_auth_sessions_user ON auth_sessions (user_id);

CREATE TABLE sessions (
  id                          INTEGER PRIMARY KEY,
  user_id                     INTEGER NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  url                         TEXT,
  source                      TEXT NOT NULL DEFAULT 'other'
                                CHECK (source IN ('the_ken', 'the_arc', 'entrackr', 'other')),
  title                       TEXT NOT NULL,
  author                      TEXT,
  published_at                TEXT,
  article_text                TEXT NOT NULL,
  word_count                  INTEGER NOT NULL DEFAULT 0,
  tags                        TEXT,
  tags_status                 TEXT NOT NULL DEFAULT 'pending'
                                CHECK (tags_status IN ('pending', 'ready', 'failed')),
  related_status              TEXT NOT NULL DEFAULT 'none'
                                CHECK (related_status IN ('none', 'pending', 'ready', 'failed')),
  stage                       TEXT NOT NULL DEFAULT 'write'
                                CHECK (stage IN ('write', 'explore', 'interview', 'verdict')),
  comprehension_text          TEXT,
  comprehension_seconds       INTEGER,
  comprehension_submitted_at  TEXT,
  comprehension_eval          TEXT,
  comprehension_score         REAL,
  interview_score             REAL,
  overall_score               REAL,
  verdict                     TEXT,
  created_at                  TEXT NOT NULL,
  updated_at                  TEXT NOT NULL
);
CREATE INDEX idx_sessions_user_created ON sessions (user_id, created_at);

CREATE TABLE related_items (
  id          INTEGER PRIMARY KEY,
  session_id  INTEGER NOT NULL REFERENCES sessions (id) ON DELETE CASCADE,
  position    INTEGER NOT NULL,
  title       TEXT NOT NULL,
  category    TEXT NOT NULL,
  why         TEXT NOT NULL,
  queries     TEXT NOT NULL,
  done        INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX idx_related_items_session ON related_items (session_id);

CREATE TABLE question_sets (
  id                  INTEGER PRIMARY KEY,
  session_id          INTEGER NOT NULL REFERENCES sessions (id) ON DELETE CASCADE,
  kind                TEXT NOT NULL CHECK (kind IN ('main', 'extra')),
  level               TEXT CHECK (level IN ('easy', 'medium', 'hard', 'super_hard')),
  difficulty_at_time  INTEGER NOT NULL,
  gen_status          TEXT NOT NULL DEFAULT 'pending' CHECK (gen_status IN ('pending', 'ready', 'failed')),
  status              TEXT NOT NULL DEFAULT 'not_started'
                        CHECK (status IN ('not_started', 'in_progress', 'answered', 'evaluated')),
  eval_status         TEXT CHECK (eval_status IN ('pending', 'ready', 'failed')),
  score               REAL,
  timeouts            INTEGER,
  avg_seconds         REAL,
  verdict             TEXT,
  started_at          TEXT,
  completed_at        TEXT,
  created_at          TEXT NOT NULL
);
CREATE INDEX idx_question_sets_session ON question_sets (session_id);

CREATE TABLE questions (
  id              INTEGER PRIMARY KEY,
  set_id          INTEGER NOT NULL REFERENCES question_sets (id) ON DELETE CASCADE,
  position        INTEGER NOT NULL,
  type            TEXT NOT NULL CHECK (type IN ('mcq', 'short', 'structured', 'estimation')),
  framework       TEXT NOT NULL,
  prompt          TEXT NOT NULL,
  options         TEXT,
  correct_option  INTEGER,
  cross_article   INTEGER NOT NULL DEFAULT 0,
  started_at      TEXT,
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

CREATE TABLE glossary_terms (
  id                INTEGER PRIMARY KEY,
  user_id           INTEGER NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  term_normalized   TEXT NOT NULL,
  display_term      TEXT NOT NULL,
  entry             TEXT NOT NULL,
  extra_examples    TEXT,
  sector            TEXT,
  lookup_count      INTEGER NOT NULL DEFAULT 1,
  first_session_id  INTEGER REFERENCES sessions (id) ON DELETE SET NULL,
  leitner_box       INTEGER NOT NULL DEFAULT 1 CHECK (leitner_box BETWEEN 1 AND 5),
  last_reviewed_at  TEXT,
  created_at        TEXT NOT NULL,
  UNIQUE (user_id, term_normalized)
);

CREATE TABLE glossary_lookups (
  id          INTEGER PRIMARY KEY,
  term_id     INTEGER NOT NULL REFERENCES glossary_terms (id) ON DELETE CASCADE,
  session_id  INTEGER REFERENCES sessions (id) ON DELETE SET NULL,
  created_at  TEXT NOT NULL
);
CREATE INDEX idx_glossary_lookups_term ON glossary_lookups (term_id);

CREATE TABLE difficulty_history (
  id          INTEGER PRIMARY KEY,
  user_id     INTEGER NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  level       INTEGER NOT NULL CHECK (level BETWEEN 1 AND 10),
  session_id  INTEGER REFERENCES sessions (id) ON DELETE SET NULL,
  created_at  TEXT NOT NULL
);
CREATE INDEX idx_difficulty_history_user ON difficulty_history (user_id, created_at);

CREATE TABLE weekly_reviews (
  id            INTEGER PRIMARY KEY,
  user_id       INTEGER NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  period_start  TEXT NOT NULL,
  period_end    TEXT NOT NULL,
  session_ids   TEXT NOT NULL,
  content       TEXT NOT NULL,
  created_at    TEXT NOT NULL
);
CREATE INDEX idx_weekly_reviews_user ON weekly_reviews (user_id, period_end);

CREATE TABLE ai_calls (
  id           INTEGER PRIMARY KEY,
  user_id      INTEGER,
  task         TEXT NOT NULL,
  model        TEXT NOT NULL,
  duration_ms  INTEGER NOT NULL,
  success      INTEGER NOT NULL,
  error        TEXT,
  created_at   TEXT NOT NULL
);
CREATE INDEX idx_ai_calls_user_created ON ai_calls (user_id, created_at);

CREATE TABLE jobs (
  id          INTEGER PRIMARY KEY,
  user_id     INTEGER NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  task        TEXT NOT NULL,
  session_id  INTEGER REFERENCES sessions (id) ON DELETE CASCADE,
  set_id      INTEGER REFERENCES question_sets (id) ON DELETE CASCADE,
  payload     TEXT,
  status      TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'running', 'done', 'failed')),
  attempts    INTEGER NOT NULL DEFAULT 0,
  error       TEXT,
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL
);
CREATE INDEX idx_jobs_user_status ON jobs (user_id, status);
`,
  },
];
