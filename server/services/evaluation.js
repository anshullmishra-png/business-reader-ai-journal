// Scores a finished question set. MCQs and blank answers are scored by the app;
// the evaluator scores open answers (and the comprehension, for main sets).
// All totals are computed here, never by the model.
import { db, now } from '../db/index.js';
import { runTask } from '../ai/gemini.js';
import { evaluateSession, evaluateExtraRound } from '../ai/prompts/evaluateSession.js';
import { getArticleText } from './sessions.js';
import { comprehensionWords } from './words.js';
import { adjustDifficulty } from './difficulty.js';
import { enqueue } from '../jobs/runner.js';

const round1 = (n) => Math.round(n * 10) / 10;
const mean = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
const COMPREHENSION_WEIGHT = 0.4;
const INTERVIEW_WEIGHT = 0.6;

function fmtMinutes(seconds) {
  const m = Math.floor((seconds ?? 0) / 60);
  const s = (seconds ?? 0) % 60;
  return m ? `${m} min ${s} sec` : `${s} sec`;
}

export async function evaluateSet(userId, setId) {
  const set = await db.get('SELECT * FROM question_sets WHERE id = ?', setId);
  if (!set || set.status !== 'answered') return;
  const session = await db.get('SELECT id, title, comprehension_text, comprehension_seconds FROM sessions WHERE id = ? AND user_id = ?', set.session_id, userId);
  if (!session) return;
  const { timer_seconds: timerSeconds } = await db.get('SELECT timer_seconds FROM users WHERE id = ?', userId);

  const questions = await db.all('SELECT * FROM questions WHERE set_id = ? ORDER BY position', setId);
  const mcqs = questions.filter((q) => q.type === 'mcq').map((q) => ({
    ...q,
    correct: q.user_answer != null && Number(q.user_answer) === q.correct_option,
  }));
  const open = questions.filter((q) => q.type !== 'mcq');
  const isMain = set.kind === 'main';

  const input = { title: session.title, text: await getArticleText(session.id), questions: open, mcqs, timerSeconds };
  const task = isMain
    ? evaluateSession({
        ...input,
        comprehension: {
          text: session.comprehension_text,
          words: comprehensionWords(session.comprehension_text),
          minutes: fmtMinutes(session.comprehension_seconds),
        },
      })
    : evaluateExtraRound(input);
  const result = await runTask({ ...task, userId });
  await saveEvaluation(userId, set, session.id, questions, mcqs, result);
}

async function saveEvaluation(userId, set, sessionId, questions, mcqs, result) {
  const byPos = new Map(result.questions.map((e) => [e.position, e]));
  const statements = [];
  const scores = [];
  for (const q of questions) {
    if (q.type === 'mcq') {
      const correct = mcqs.find((m) => m.id === q.id).correct;
      const s = correct ? 10 : 0;
      const feedback = correct ? 'Correct.' : q.user_answer == null ? 'No answer.' : 'Wrong.';
      // model_answer already holds the explanation written at generation time.
      statements.push(['UPDATE questions SET score = ?, feedback = ?, model_answer = ? WHERE id = ?', s, feedback, q.model_answer, q.id]);
      scores.push(s);
    } else {
      const e = byPos.get(q.position);
      // A blank answer is a zero, whatever the model says.
      const s = q.user_answer ? round1(e.score) : 0;
      statements.push(['UPDATE questions SET score = ?, feedback = ?, model_answer = ? WHERE id = ?', s, e.feedback, e.model_answer, q.id]);
      scores.push(s);
    }
  }
  const interview = round1(mean(scores));
  statements.push([`UPDATE question_sets SET score = ?, status = 'evaluated', eval_status = 'ready' WHERE id = ?`, interview, set.id]);

  if (set.kind === 'main') {
    const comp = round1(mean(result.comprehension.map((c) => c.score)));
    const overall = round1(COMPREHENSION_WEIGHT * comp + INTERVIEW_WEIGHT * interview);
    statements.push([`UPDATE sessions SET comprehension_eval = ?, comprehension_score = ?, interview_score = ?,
                      overall_score = ?, verdict = ?, updated_at = ? WHERE id = ?`,
      JSON.stringify(result.comprehension), comp, interview, overall,
      JSON.stringify({ summary: result.summary, work_on_next: result.work_on_next }), now(), sessionId]);
    await db.batch(statements);
    await adjustDifficulty(userId, sessionId);
  } else {
    // Extra rounds keep their own verdict and never touch the session's scores.
    statements.push(['UPDATE question_sets SET verdict = ? WHERE id = ?',
      JSON.stringify({ summary: result.summary, work_on_next: result.work_on_next }), set.id]);
    await db.batch(statements);
  }
}

export const markEvaluationFailed = (setId) => db.run("UPDATE question_sets SET eval_status = 'failed' WHERE id = ?", setId);

export async function retryEvaluation(userId, setId) {
  const set = await db.get('SELECT * FROM question_sets WHERE id = ?', setId);
  if (!set || set.status !== 'answered' || set.eval_status !== 'failed') return false;
  await db.run("UPDATE question_sets SET eval_status = 'pending' WHERE id = ?", setId);
  await enqueue(set.kind === 'main' ? 'evaluate_session' : 'evaluate_extra', { userId, sessionId: set.session_id, setId });
  return true;
}
