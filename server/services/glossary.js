// Dictionary lookups (cache first), the glossary, and the Leitner vocab quiz.
// Each user has their own glossary.
import { db, now } from '../db/index.js';
import { runTask } from '../ai/gemini.js';
import { defineTerm, moreExamples } from '../ai/prompts/dictionary.js';
import { httpError } from './auth.js';

// ---------- Normalisation: "CACs", " cac " and "CAC" are one entry ----------
const KEEP_S = /(ss|us|is|ics|sis|ness|ous|as)$/; // business, bonus, analysis, economics, gross...

function singular(word) {
  if (word.length <= 3) return word;
  if (/ies$/.test(word) && word.length > 4) return `${word.slice(0, -3)}y`;
  if (/(sses|ches|shes|xes)$/.test(word)) return word.slice(0, -2);
  if (/s$/.test(word) && !KEEP_S.test(word)) return word.slice(0, -1);
  return word;
}

export function normalizeTerm(raw) {
  const words = String(raw)
    .toLowerCase()
    .normalize('NFKC')
    .replace(/[“”"'’`]/g, '')
    .replace(/[^\p{L}\p{N}&/+\-\s().%]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^[\s().\-]+|[\s().\-]+$/g, '')
    .split(' ');
  // Only the last word is pluralised in English phrases ("customer acquisition costs").
  words[words.length - 1] = singular(words[words.length - 1]);
  return words.join(' ');
}

// ---------- Rows ----------
function hydrate(row) {
  if (!row) return null;
  const entry = JSON.parse(row.entry);
  return {
    id: row.id,
    term: row.display_term,
    normalized: row.term_normalized,
    ...entry,
    examples: [...entry.examples, ...(row.extra_examples ? JSON.parse(row.extra_examples) : [])],
    sector: row.sector,
    lookup_count: row.lookup_count,
    first_session_id: row.first_session_id,
    first_session_title: row.first_session_title ?? null,
    leitner_box: row.leitner_box,
    last_reviewed_at: row.last_reviewed_at,
    created_at: row.created_at,
  };
}

const SELECT = `SELECT g.*, s.title AS first_session_title FROM glossary_terms g
                LEFT JOIN sessions s ON s.id = g.first_session_id`;

export async function getTerm(userId, id) {
  const t = hydrate(await db.get(`${SELECT} WHERE g.id = ? AND g.user_id = ?`, id, userId));
  if (!t) throw httpError(404, 'Term not found');
  return t;
}

const byNormalized = (userId, n) => db.get('SELECT id FROM glossary_terms WHERE user_id = ? AND term_normalized = ?', userId, n);

const recordLookup = (termId, sessionId) => db.batch([
  ['UPDATE glossary_terms SET lookup_count = lookup_count + 1 WHERE id = ?', termId],
  ['INSERT INTO glossary_lookups (term_id, session_id, created_at) VALUES (?, ?, ?)', termId, sessionId, now()],
]);

async function ownSession(userId, id) {
  if (id == null) return null;
  return (await db.get('SELECT id FROM sessions WHERE id = ? AND user_id = ?', id, userId)) ? id : null;
}

// In-flight AI lookups (per instance), so two quick clicks on one new term make one call.
const inflight = new Map();

/**
 * Cache first: a saved term returns instantly with zero AI calls.
 * @returns {Promise<{ term: object, cached: boolean }>}
 */
export async function lookup(userId, rawTerm, sessionId = null) {
  const normalized = normalizeTerm(rawTerm);
  if (!normalized || normalized.length < 2) throw httpError(400, 'Type a term to look up.');
  const linkSession = await ownSession(userId, sessionId);

  const hit = await byNormalized(userId, normalized);
  if (hit) {
    await recordLookup(hit.id, linkSession);
    return { term: await getTerm(userId, hit.id), cached: true };
  }

  const key = `${userId}:${normalized}`;
  if (!inflight.has(key)) {
    inflight.set(key, runTask({ ...defineTerm({ term: String(rawTerm).trim() }), userId }).finally(() => inflight.delete(key)));
  }
  const entry = await inflight.get(key);
  if (!entry.is_business_term) {
    throw httpError(422, `"${String(rawTerm).trim()}" doesn't look like a business term.`, { code: 'not_business' });
  }

  // Another request may have saved it while we waited.
  const existing = await byNormalized(userId, normalized);
  if (existing) {
    await recordLookup(existing.id, linkSession);
    return { term: await getTerm(userId, existing.id), cached: true };
  }
  const { is_business_term: _, display_term, sector, ...stored } = entry;
  const { lastInsertRowid: id } = await db.run(`
    INSERT INTO glossary_terms (user_id, term_normalized, display_term, entry, sector, lookup_count, first_session_id, created_at)
    VALUES (?, ?, ?, ?, ?, 0, ?, ?)`, userId, normalized, display_term, JSON.stringify(stored), sector, linkSession, now());
  await recordLookup(id, linkSession);
  return { term: await getTerm(userId, id), cached: false };
}

export async function addExamples(userId, id) {
  const t = await getTerm(userId, id);
  const { examples } = await runTask({ ...moreExamples({ term: t.term, existing: t.examples.map((e) => e.company) }), userId });
  const row = await db.get('SELECT extra_examples FROM glossary_terms WHERE id = ?', id);
  const extra = [...(row.extra_examples ? JSON.parse(row.extra_examples) : []), ...examples];
  await db.run('UPDATE glossary_terms SET extra_examples = ? WHERE id = ?', JSON.stringify(extra), id);
  return getTerm(userId, id);
}

export async function listTerms(userId, { q = '', sort = 'az', sector = '' } = {}) {
  const order = { az: 'lower(g.display_term) ASC', count: 'g.lookup_count DESC, lower(g.display_term)',
    newest: 'g.created_at DESC' }[sort] ?? 'lower(g.display_term) ASC';
  const where = ['g.user_id = ?'];
  const params = [userId];
  if (q) { where.push('(g.display_term ILIKE ? OR g.term_normalized ILIKE ? OR g.entry ILIKE ?)'); params.push(`%${q}%`, `%${q}%`, `%${q}%`); }
  if (sector) { where.push('g.sector = ?'); params.push(sector); }
  return (await db.all(`${SELECT} WHERE ${where.join(' AND ')} ORDER BY ${order}`, ...params)).map(hydrate);
}

export async function deleteTerm(userId, id) {
  await getTerm(userId, id);
  await db.batch([
    ['DELETE FROM glossary_lookups WHERE term_id = ?', id],
    ['DELETE FROM glossary_terms WHERE id = ? AND user_id = ?', id, userId],
  ]);
}

// ---------- Leitner quiz ----------
// Box n is due again after INTERVAL_DAYS[n] days. A right answer moves a card
// up one box; a wrong one sends it back to box 1.
export const INTERVAL_DAYS = { 1: 0, 2: 2, 3: 4, 4: 8, 5: 16 };

export async function boxCounts(userId) {
  const counts = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
  for (const r of await db.all('SELECT leitner_box b, COUNT(*) n FROM glossary_terms WHERE user_id = ? GROUP BY leitner_box', userId)) counts[r.b] = r.n;
  return counts;
}

function isDue(t, nowMs) {
  if (!t.last_reviewed_at) return true;
  return nowMs - Date.parse(t.last_reviewed_at) >= INTERVAL_DAYS[t.leitner_box] * 86400000;
}

const shuffle = (xs) => {
  const a = [...xs];
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
};

/**
 * Builds a quiz from saved entries with no AI: flashcards (self-graded) and
 * MCQs whose distractors are other saved definitions. If nothing is due,
 * falls back to the lowest boxes so a manual quiz is never empty.
 */
export async function buildQuiz(userId, size = 10) {
  const all = await listTerms(userId);
  if (!all.length) return { items: [], due: 0 };
  const nowMs = Date.now();
  const due = all.filter((t) => isDue(t, nowMs));
  const pool = (due.length ? due : all)
    .sort((a, b) => a.leitner_box - b.leitner_box || (a.last_reviewed_at ?? '').localeCompare(b.last_reviewed_at ?? ''))
    .slice(0, size);
  const canMcq = all.length >= 4;
  const items = shuffle(pool).map((t, i) => {
    const base = { id: t.id, term: t.term, box: t.leitner_box, definition: t.definition };
    if (!canMcq || i % 2 === 0) return { ...base, kind: 'flashcard' };
    const distractors = shuffle(all.filter((o) => o.id !== t.id)).slice(0, 3).map((o) => o.definition);
    const options = shuffle([t.definition, ...distractors]);
    return { ...base, kind: 'mcq', options, correct: options.indexOf(t.definition) };
  });
  return { items, due: due.length };
}

export async function recordReview(userId, id, correct) {
  const t = await getTerm(userId, id);
  const box = correct ? Math.min(5, t.leitner_box + 1) : 1;
  await db.run('UPDATE glossary_terms SET leitner_box = ?, last_reviewed_at = ? WHERE id = ?', box, now(), id);
  return { id, box };
}
