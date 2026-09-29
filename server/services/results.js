// Verdict data and extra rounds. Questions, correct options and model answers
// are only ever returned for sets that have been answered and scored.
import { db, now } from '../db/index.js';
import { enqueue } from '../jobs/runner.js';
import { httpError, requireSession } from './sessions.js';
import { LEVEL_TO_DIFFICULTY } from '../ai/prompts/generateQuestions.js';
import { COMPREHENSION_DIMENSIONS } from '../ai/schemas.js';

export const EXTRA_LEVELS = Object.keys(LEVEL_TO_DIFFICULTY);

function setResult(set) {
  const out = {
    id: set.id,
    kind: set.kind,
    level: set.level,
    gen_status: set.gen_status,
    status: set.status,
    eval_status: set.eval_status,
    score: set.score,
    timeouts: set.timeouts,
    avg_seconds: set.avg_seconds,
    verdict: set.verdict ? JSON.parse(set.verdict) : null,
    created_at: set.created_at,
    questions: [],
  };
  if (set.status === 'evaluated') {
    out.questions = db.prepare('SELECT * FROM questions WHERE set_id = ? ORDER BY position').all(set.id).map((q) => ({
      position: q.position,
      type: q.type,
      framework: q.framework,
      prompt: q.prompt,
      options: q.options ? JSON.parse(q.options) : null,
      correct_option: q.correct_option,
      cross_article: Boolean(q.cross_article),
      user_answer: q.user_answer,
      seconds_used: q.seconds_used,
      timed_out: Boolean(q.timed_out),
      score: q.score,
      feedback: q.feedback,
      model_answer: q.model_answer,
    }));
  }
  return out;
}

export function getResults(sessionId) {
  const s = requireSession(sessionId);
  if (s.stage !== 'verdict') throw httpError(409, 'Results are available after the interview.');
  const sets = db.prepare('SELECT * FROM question_sets WHERE session_id = ? ORDER BY id').all(sessionId);
  const main = sets.find((x) => x.kind === 'main');
  return {
    session_id: s.id,
    overall_score: s.overall_score,
    comprehension_score: s.comprehension_score,
    interview_score: s.interview_score,
    verdict: s.verdict,
    comprehension: (s.comprehension_eval ?? []).map((c) => ({ ...c, label: COMPREHENSION_DIMENSIONS[c.dimension] })),
    main: main ? setResult(main) : null,
    extras: sets.filter((x) => x.kind === 'extra').map(setResult),
  };
}

/** Starts generating a 10-question extra round. One round at a time. */
export function createExtraSet(sessionId, level) {
  const s = requireSession(sessionId);
  if (s.stage !== 'verdict' || s.overall_score == null) {
    throw httpError(409, 'Extra rounds open once your verdict is in.');
  }
  const open = db.prepare(`SELECT id FROM question_sets WHERE session_id = ? AND kind = 'extra'
    AND (status IN ('not_started', 'in_progress') OR (status = 'answered' AND eval_status != 'failed'))`).get(sessionId);
  if (open) throw httpError(409, 'Finish the current extra round first.');
  const { lastInsertRowid } = db.prepare(`
    INSERT INTO question_sets (session_id, kind, level, difficulty_at_time, gen_status, status, created_at)
    VALUES (?, 'extra', ?, ?, 'pending', 'not_started', ?)`).run(sessionId, level, LEVEL_TO_DIFFICULTY[level], now());
  const setId = Number(lastInsertRowid);
  enqueue('generate_questions', { sessionId, setId });
  return setId;
}

export function startExtraSet(sessionId, setId) {
  const { changes } = db.prepare(`UPDATE question_sets SET status = 'in_progress', started_at = ?
    WHERE id = ? AND session_id = ? AND kind = 'extra' AND gen_status = 'ready' AND status = 'not_started'`)
    .run(now(), setId, sessionId);
  if (changes === 0) throw httpError(409, 'This round is not ready to start, or has already started.');
}
