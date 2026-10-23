// Adaptive difficulty (level 1-10), per user, adjusted after each scored session:
// up one if the average of the last 5 interview scores is >= 7, down one if
// <= 4, otherwise hold. It only moves once 5 scores exist; every session
// still records the level it ended on, for the step chart.
import { db, now } from '../db/index.js';

export const WINDOW = 5;
export const UP_AT = 7;
export const DOWN_AT = 4;

export function nextLevel(level, recentScores) {
  if (recentScores.length < WINDOW) return level;
  const avg = recentScores.reduce((a, b) => a + b, 0) / recentScores.length;
  if (avg >= UP_AT) return Math.min(10, level + 1);
  if (avg <= DOWN_AT) return Math.max(1, level - 1);
  return level;
}

/** Call once per session after its interview score is saved. Returns the new level. */
export async function adjustDifficulty(userId, sessionId) {
  const scores = (await db.all(`
    SELECT qs.score FROM question_sets qs JOIN sessions s ON s.id = qs.session_id
    WHERE s.user_id = ? AND qs.kind = 'main' AND qs.score IS NOT NULL
    ORDER BY qs.completed_at DESC LIMIT ?`, userId, WINDOW)).map((r) => r.score);
  const { difficulty_level: current } = await db.get('SELECT difficulty_level FROM users WHERE id = ?', userId);
  const level = nextLevel(current, scores);
  await db.batch([
    ['UPDATE users SET difficulty_level = ? WHERE id = ?', level, userId],
    ['INSERT INTO difficulty_history (user_id, level, session_id, created_at) VALUES (?, ?, ?, ?)', userId, level, sessionId, now()],
  ]);
  return level;
}
