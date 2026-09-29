import { EVALUATOR } from '../persona.js';
import { makeEvaluationSchema, COMPREHENSION_DIMENSIONS } from '../schemas.js';

const MAX_ARTICLE_CHARS = 30000;
const TYPE_LABELS = { short: 'Short answer', structured: 'Structured', estimation: 'Estimation' };

function answersBlock(questions, timerSeconds) {
  return questions.map((q) => `--- Question ${q.position} (${TYPE_LABELS[q.type]} · ${q.framework}${q.cross_article ? ' · links to an earlier article' : ''})
${q.prompt}

Candidate's answer (${q.seconds_used ?? timerSeconds}s of ${timerSeconds}s${q.timed_out ? ', ran out of time' : ''}):
${q.user_answer ? q.user_answer : '[NO ANSWER]'}`).join('\n\n');
}

function mcqBlock(mcqs) {
  if (!mcqs.length) return '';
  const lines = mcqs.map((q) => `Q${q.position} (${q.framework}): ${q.correct ? 'correct' : q.user_answer == null ? 'no answer' : 'wrong'}`);
  return `\nMultiple-choice results (already scored by the app, do NOT include them in "questions"; use them only for the summary and "work_on_next"):\n${lines.join('\n')}\n`;
}

const RUBRIC = `Scoring each open question (0-10, whole numbers):
- 0: no answer, or irrelevant.
- 3: vague, generic, no numbers where numbers were needed, or not MECE when structure was asked for.
- 5: acceptable first-round answer: correct direction, some specifics.
- 7: strong: specific, structured, numbers with stated assumptions.
- 8+: rare: all of the above plus a non-obvious insight.
Estimations: judge the logic and assumptions, not whether the number matches yours exactly. An estimate with no stated assumptions caps at 4.
Structured answers that overlap or leave gaps (not MECE) cap at 5.
Account for the time limit: model answers must be writable in about the time the candidate had.
Feedback: speak to the candidate directly ("You..."). Say exactly what was missing. No compliments unless earned.`;

function build({ task, title, text, comprehension, questions, mcqs, timerSeconds }) {
  const body = text.length > MAX_ARTICLE_CHARS ? `${text.slice(0, MAX_ARTICLE_CHARS)}\n[…truncated]` : text;
  const positions = questions.map((q) => q.position);
  const withComprehension = Boolean(comprehension);
  return {
    task,
    tier: 'strong',
    system: EVALUATOR,
    schema: makeEvaluationSchema(positions, { withComprehension }),
    prompt: `Evaluate this candidate's mock interview${withComprehension ? ' and written comprehension' : ''} about the article below.

${withComprehension ? `PART 1: COMPREHENSION
The candidate read the article and wrote this ${comprehension.words}-word summary in ${comprehension.minutes}:
"""
${comprehension.text}
"""

Score each of these 5 dimensions (0-10) with ONE line of critique:
${Object.entries(COMPREHENSION_DIMENSIONS).map(([k, v]) => `- ${k}: ${v}`).join('\n')}
"omissions" rewards noticing what the article left out: missing numbers, unasked questions, the other side of the story.

PART 2: ` : ''}INTERVIEW ANSWERS
Evaluate each question below and return one entry per question with its position, score, feedback and model_answer.
Positions to return: ${positions.join(', ') || '(none)'}.

${RUBRIC}

${answersBlock(questions, timerSeconds)}
${mcqBlock(mcqs)}
FINALLY
- summary: a one or two sentence verdict on the whole ${withComprehension ? 'session' : 'round'}, in your voice.
- work_on_next: exactly 2 items, each tied to the weakest framework${withComprehension ? ' or comprehension dimension' : ''} in THIS ${withComprehension ? 'session' : 'round'}. Concrete drills, not platitudes.

Article (for grounding your judgement; the candidate has read it):
Title: ${title}
"""
${body}
"""`,
  };
}

export const evaluateSession = (o) => build({ ...o, task: 'evaluateSession' });
export const evaluateExtraRound = (o) => build({ ...o, comprehension: null, task: 'evaluateExtraRound' });
