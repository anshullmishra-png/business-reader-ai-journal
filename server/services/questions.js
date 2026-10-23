// Question sets. Callers check session ownership first.
import { db, now } from '../db/index.js';
import { enqueue } from '../jobs/runner.js';

/** Creates the session's main question set and queues generation. Idempotent. */
export async function createMainSet(userId, sessionId) {
  const existing = await db.get("SELECT id FROM question_sets WHERE session_id = ? AND kind = 'main'", sessionId);
  if (existing) return existing.id;
  const { difficulty_level: level } = await db.get('SELECT difficulty_level FROM users WHERE id = ?', userId);
  const { lastInsertRowid: setId } = await db.run(`
    INSERT INTO question_sets (session_id, kind, difficulty_at_time, gen_status, status, created_at)
    VALUES (?, 'main', ?, 'pending', 'not_started', ?)`, sessionId, level, now());
  await enqueue('generate_questions', { userId, sessionId, setId });
  return setId;
}

export const getSet = (setId) => db.get('SELECT * FROM question_sets WHERE id = ?', setId);

export async function getMainSet(sessionId) {
  return (await db.get("SELECT * FROM question_sets WHERE session_id = ? AND kind = 'main'", sessionId)) ?? null;
}

export const setGenStatus = (setId, status) => db.run('UPDATE question_sets SET gen_status = ? WHERE id = ?', status, setId);

export async function retryGeneration(userId, setId) {
  const set = await getSet(setId);
  if (!set || set.gen_status !== 'failed') return false;
  await setGenStatus(setId, 'pending');
  await enqueue('generate_questions', { userId, sessionId: set.session_id, setId });
  return true;
}

function shuffleMcq(q) {
  // Models favour certain answer positions; shuffle so the right answer is anywhere.
  const order = [0, 1, 2, 3].sort(() => Math.random() - 0.5);
  return { ...q, options: order.map((i) => q.options[i]), correct_option: order.indexOf(q.correct_option) };
}

/** Stores a validated set of 10 questions and marks the set ready (a retry replaces any partial set). */
export async function saveQuestions(setId, questions, { allowCrossArticle }) {
  await db.batch([
    ['DELETE FROM questions WHERE set_id = ?', setId],
    ...questions.map((raw, i) => {
      const q = raw.type === 'mcq' ? shuffleMcq(raw) : raw;
      return [`INSERT INTO questions (set_id, position, type, framework, prompt, options, correct_option, cross_article, model_answer)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        setId, i + 1, q.type, q.framework, q.prompt,
        q.options ? JSON.stringify(q.options) : null,
        q.correct_option ?? null,
        allowCrossArticle && q.cross_article ? 1 : 0,
        q.type === 'mcq' ? q.explanation : null]; // the MCQ "why" is revealed at the verdict
    }),
    ["UPDATE question_sets SET gen_status = 'ready' WHERE id = ?", setId],
  ]);
}

/** Compact summaries of the user's recent sessions, for cross-article questions. */
export async function recentHistory(userId, excludeSessionId, limit = 15) {
  const rows = await db.all(`SELECT title, tags, created_at FROM sessions
                             WHERE user_id = ? AND id != ? AND tags IS NOT NULL
                             ORDER BY created_at DESC LIMIT ?`, userId, excludeSessionId, limit);
  return rows.map((r) => ({ title: r.title, tags: JSON.parse(r.tags), date: r.created_at.slice(0, 10) }));
}
