// Adaptive difficulty (level 1-10), adjusted after each scored session:
// up one if the average of the last 5 interview scores is >= 7, down one if
// <= 4, otherwise hold. It only moves once 5 scores exist; every session
// still records the level it ended on, for the step chart.
import { db, now } from '../db/index.js';
import { getSetting, setSetting } from './settings.js';

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
export function adjustDifficulty(sessionId) {
  const scores = db.prepare(`
    SELECT score FROM question_sets
    WHERE kind = 'main' AND score IS NOT NULL
    ORDER BY completed_at DESC LIMIT ?`).all(WINDOW).map((r) => r.score);
  const current = getSetting('difficulty_level');
  const level = nextLevel(current, scores);
  if (level !== current) setSetting('difficulty_level', level);
  db.prepare('INSERT INTO difficulty_history (level, session_id, created_at) VALUES (?, ?, ?)').run(level, sessionId, now());
  return level;
}
