import { ANALYST } from '../persona.js';
import { QuestionSet } from '../schemas.js';
import { FRAMEWORKS } from '../taxonomy.js';

const MAX_ARTICLE_CHARS = 30000;

export const DIFFICULTY_GUIDE = {
  1: 'Recall key facts and name the obvious business concept. Numbers are given.',
  2: 'Recall plus one simple "why". Estimations use numbers stated in the article.',
  3: 'Apply one framework to the article. Simple estimations with 1-2 assumptions.',
  4: 'Apply a framework and justify it. Estimations need 2-3 stated assumptions.',
  5: 'Multi-step reasoning combining the article with general business knowledge. Typical first-round interview.',
  6: 'Trade-offs with no single right answer; the candidate must pick and defend. Estimations with sparse anchors.',
  7: 'Second-order effects, competitive responses, founder-level decisions under ambiguity.',
  8: 'Stress-test the article\'s thesis. Unit economics from scratch. Final-round Chief of Staff interview.',
  9: 'Non-obvious insights only. Questions a sharp founder would ask the author. Tight, multi-variable estimations.',
  10: 'The hardest questions a top founder\'s office would ask. Every answer needs numbers, structure and an original angle.',
};

// Extra-round levels (phase 7) map onto the same scale.
export const LEVEL_TO_DIFFICULTY = { easy: 3, medium: 5, hard: 7, super_hard: 9 };

function historyBlock(history) {
  if (!history.length) {
    return 'There are no earlier articles yet. Set cross_article to false for every question.';
  }
  const lines = history.map((h, i) => {
    const t = h.tags ?? {};
    return `${i + 1}. [${h.date}] ${h.title} | companies: ${(t.companies ?? []).join(', ') || '-'} | sector: ${t.sector ?? '-'} | themes: ${(t.themes ?? []).join(', ') || '-'}`;
  });
  return `Earlier articles the candidate has read (most recent first):
${lines.join('\n')}

Exactly 1 or 2 questions must connect THIS article to one of these earlier articles (a comparison, a shared pattern, a contrast in business model). Mark those with cross_article: true and name the earlier company or article in the question. All other questions: cross_article: false.`;
}

/**
 * @param {object} o
 * @param {string} o.title
 * @param {string} o.source
 * @param {string} o.text     full article text (grounding)
 * @param {number} o.difficulty 1-10
 * @param {number} o.timerSeconds seconds the candidate gets per question
 * @param {Array} o.history   compact summaries of recent sessions
 */
export function generateQuestions({ title, source, text, difficulty, timerSeconds, history, task = 'generateQuestions' }) {
  const body = text.length > MAX_ARTICLE_CHARS ? `${text.slice(0, MAX_ARTICLE_CHARS)}\n[…truncated]` : text;
  return {
    task,
    tier: 'strong',
    system: ANALYST,
    schema: QuestionSet,
    prompt: `Write a 10-question mock interview for a Chief of Staff / Founder's Office candidate who has just read the article below.

DIFFICULTY: level ${difficulty} of 10. ${DIFFICULTY_GUIDE[difficulty]}

TIME: the candidate has ${timerSeconds} seconds to type each answer. Every question must be answerable in that time: short answers in 1-3 sentences, structured answers as 3-4 short bullets, estimations as a number plus 2-4 lines of assumptions.

QUESTION TYPES (use exactly these values in "type"; at least 2 of each, 10 total, mixed order):
- "mcq": multiple choice with exactly 4 plausible options, one clearly correct. Distractors must be tempting, not silly. Give "correct_option" (0-based) and a 1-2 sentence "explanation".
- "short": an open question needing a crisp, specific answer.
- "structured": asks for a breakdown, e.g. "Break down the drivers of X into 3-4 MECE buckets".
- "estimation": a market sizing or unit-economics estimate (CAC, LTV, contribution margin, payback, TAM/SAM/SOM, break-even). Ask for a number.
For non-MCQ types set options, correct_option and explanation to null.

FRAMEWORKS: tag every question with the one framework it mainly tests, chosen from exactly this list:
${FRAMEWORKS.map((f) => `- ${f}`).join('\n')}
Use at least 6 different frameworks across the 10 questions. Pick the ones that genuinely fit this article.

GROUNDING:
- Any fact an MCQ tests must come from the article. Do not invent facts about the companies.
- Other questions may combine the article with general business knowledge.
- Never put the answer, or a hint to it, inside the question.
- No two questions may test the same fact, number or calculation. No question may give away the answer to another
  (questions are shown one at a time, in order).

${historyBlock(history)}

Source: ${source}
Title: ${title}

Article:
"""
${body}
"""`,
  };
}
