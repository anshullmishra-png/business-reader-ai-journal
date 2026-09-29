// Dictionary lookups (cache first), the glossary, and the Leitner vocab quiz.
import { db, now } from '../db/index.js';
import { runTask } from '../ai/claudeBridge.js';
import { defineTerm, moreExamples } from '../ai/prompts/dictionary.js';
import { httpError } from './sessions.js';

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

export function getTerm(id) {
  const t = hydrate(db.prepare(`${SELECT} WHERE g.id = ?`).get(id));
  if (!t) throw httpError(404, 'Term not found');
  return t;
}

const byNormalized = (n) => db.prepare('SELECT id FROM glossary_terms WHERE term_normalized = ?').get(n);

function recordLookup(termId, sessionId) {
  db.transaction(() => {
    db.prepare('UPDATE glossary_terms SET lookup_count = lookup_count + 1 WHERE id = ?').run(termId);
    db.prepare('INSERT INTO glossary_lookups (term_id, session_id, created_at) VALUES (?, ?, ?)').run(termId, sessionId, now());
  })();
}

const sessionExists = (id) => id != null && Boolean(db.prepare('SELECT 1 FROM sessions WHERE id = ?').get(id));

// In-flight AI lookups, so two quick clicks on the same new term make one call.
const inflight = new Map();

/**
 * Cache first: a saved term returns instantly with zero AI calls.
 * @returns {Promise<{ term: object, cached: boolean }>}
 */
export async function lookup(rawTerm, sessionId = null) {
  const normalized = normalizeTerm(rawTerm);
  if (!normalized || normalized.length < 2) throw httpError(400, 'Type a term to look up.');
  const linkSession = sessionExists(sessionId) ? sessionId : null;

  const hit = byNormalized(normalized);
  if (hit) {
    recordLookup(hit.id, linkSession);
    return { term: getTerm(hit.id), cached: true };
  }

  if (!inflight.has(normalized)) {
    inflight.set(normalized, runTask(defineTerm({ term: String(rawTerm).trim() }))
      .finally(() => inflight.delete(normalized)));
  }
  const entry = await inflight.get(normalized);
  if (!entry.is_business_term) {
    throw httpError(422, `"${String(rawTerm).trim()}" doesn't look like a business term.`, { code: 'not_business' });
  }

  // Another request may have saved it while we waited.
  const existing = byNormalized(normalized);
  if (existing) {
    recordLookup(existing.id, linkSession);
    return { term: getTerm(existing.id), cached: true };
  }
  const { is_business_term: _, display_term, sector, ...stored } = entry;
  const t = now();
  const { lastInsertRowid } = db.prepare(`
    INSERT INTO glossary_terms (term_normalized, display_term, entry, sector, lookup_count, first_session_id, created_at)
    VALUES (?, ?, ?, ?, 0, ?, ?)`).run(normalized, display_term, JSON.stringify(stored), sector, linkSession, t);
  recordLookup(Number(lastInsertRowid), linkSession);
  return { term: getTerm(Number(lastInsertRowid)), cached: false };
}

export async function addExamples(id) {
  const t = getTerm(id);
  const { examples } = await runTask(moreExamples({ term: t.term, existing: t.examples.map((e) => e.company) }));
  const row = db.prepare('SELECT extra_examples FROM glossary_terms WHERE id = ?').get(id);
  const extra = [...(row.extra_examples ? JSON.parse(row.extra_examples) : []), ...examples];
  db.prepare('UPDATE glossary_terms SET extra_examples = ? WHERE id = ?').run(JSON.stringify(extra), id);
  return getTerm(id);
}

export function listTerms({ q = '', sort = 'az', sector = '' } = {}) {
  const order = { az: 'g.display_term COLLATE NOCASE ASC', count: 'g.lookup_count DESC, g.display_term COLLATE NOCASE',
    newest: 'g.created_at DESC' }[sort] ?? 'g.display_term COLLATE NOCASE ASC';
  const where = [];
  const params = [];
  if (q) { where.push('(g.display_term LIKE ? OR g.term_normalized LIKE ? OR g.entry LIKE ?)'); params.push(`%${q}%`, `%${q}%`, `%${q}%`); }
  if (sector) { where.push('g.sector = ?'); params.push(sector); }
  return db.prepare(`${SELECT} ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY ${order}`)
    .all(...params).map(hydrate);
}

export function deleteTerm(id) {
  getTerm(id);
  db.prepare('DELETE FROM glossary_terms WHERE id = ?').run(id);
}

// ---------- Leitner quiz ----------
// Box n is due again after INTERVAL_DAYS[n] days. A right answer moves a card
// up one box; a wrong one sends it back to box 1.
export const INTERVAL_DAYS = { 1: 0, 2: 2, 3: 4, 4: 8, 5: 16 };

export function boxCounts() {
  const counts = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
  for (const r of db.prepare('SELECT leitner_box b, COUNT(*) n FROM glossary_terms GROUP BY leitner_box').all()) counts[r.b] = r.n;
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
export function buildQuiz(size = 10) {
  const all = listTerms();
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

export function recordReview(id, correct) {
  const t = getTerm(id);
  const box = correct ? Math.min(5, t.leitner_box + 1) : 1;
  db.prepare('UPDATE glossary_terms SET leitner_box = ?, last_reviewed_at = ? WHERE id = ?').run(box, now(), id);
  return { id, box };
}
