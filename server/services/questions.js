import { db, now } from '../db/index.js';
import { enqueue } from '../jobs/runner.js';
import { getSetting } from './settings.js';

/** Creates the session's main question set and queues generation. Idempotent. */
export function createMainSet(sessionId) {
  const existing = db.prepare("SELECT id FROM question_sets WHERE session_id = ? AND kind = 'main'").get(sessionId);
  if (existing) return existing.id;
  const { lastInsertRowid } = db.prepare(`
    INSERT INTO question_sets (session_id, kind, difficulty_at_time, gen_status, status, created_at)
    VALUES (?, 'main', ?, 'pending', 'not_started', ?)`).run(sessionId, getSetting('difficulty_level'), now());
  const setId = Number(lastInsertRowid);
  enqueue('generate_questions', { sessionId, setId });
  return setId;
}

export function getSet(setId) {
  return db.prepare('SELECT * FROM question_sets WHERE id = ?').get(setId);
}

export function getMainSet(sessionId) {
  return db.prepare("SELECT * FROM question_sets WHERE session_id = ? AND kind = 'main'").get(sessionId) ?? null;
}

export function setGenStatus(setId, status) {
  db.prepare('UPDATE question_sets SET gen_status = ? WHERE id = ?').run(status, setId);
}

export function retryGeneration(setId) {
  const set = getSet(setId);
  if (!set || set.gen_status !== 'failed') return false;
  setGenStatus(setId, 'pending');
  enqueue('generate_questions', { sessionId: set.session_id, setId });
  return true;
}

function shuffleMcq(q) {
  // Models favour certain answer positions; shuffle so the right answer is anywhere.
  const order = [0, 1, 2, 3].sort(() => Math.random() - 0.5);
  return {
    ...q,
    options: order.map((i) => q.options[i]),
    correct_option: order.indexOf(q.correct_option),
  };
}

/** Stores a validated set of 10 questions and marks the set ready. */
export function saveQuestions(setId, questions, { allowCrossArticle }) {
  const insert = db.prepare(`
    INSERT INTO questions (set_id, position, type, framework, prompt, options, correct_option, cross_article, model_answer)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`);
  db.transaction(() => {
    db.prepare('DELETE FROM questions WHERE set_id = ?').run(setId); // a retry replaces any partial set
    questions.forEach((raw, i) => {
      const q = raw.type === 'mcq' ? shuffleMcq(raw) : raw;
      insert.run(
        setId, i + 1, q.type, q.framework, q.prompt,
        q.options ? JSON.stringify(q.options) : null,
        q.correct_option,
        allowCrossArticle && q.cross_article ? 1 : 0,
        q.type === 'mcq' ? q.explanation : null, // MCQ "why" is revealed at the verdict
      );
    });
    setGenStatus(setId, 'ready');
  })();
}

/** Compact summaries of recent sessions, for cross-article questions. */
export function recentHistory(excludeSessionId, limit = 15) {
  return db.prepare(`
    SELECT title, tags, created_at FROM sessions
    WHERE id != ? AND tags IS NOT NULL
    ORDER BY created_at DESC LIMIT ?`).all(excludeSessionId, limit)
    .map((r) => ({ title: r.title, tags: JSON.parse(r.tags), date: r.created_at.slice(0, 10) }));
}
