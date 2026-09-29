import { html, raw, $, $$ } from '../lib/dom.js';
import { api } from '../lib/api.js';
import { icon } from '../lib/icons.js';
import { setHeader } from '../shell.js';
import { sessionCard } from '../lib/sessionCard.js';
import { SOURCE_LABELS } from '../lib/format.js';

const SCORE_BANDS = {
  '': 'Any score',
  low: 'Below 5',
  mid: '5 to 7',
  high: 'Above 7',
  unscored: 'Not scored yet',
};

function inBand(s, band) {
  const v = s.overall_score;
  if (!band) return true;
  if (band === 'unscored') return v == null;
  if (v == null) return false;
  if (band === 'low') return v < 5;
  if (band === 'high') return v > 7;
  return v >= 5 && v <= 7;
}

// Local calendar date (YYYY-MM-DD) of an ISO timestamp, to compare with <input type="date">.
const localDay = (iso) => {
  const d = new Date(iso);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

const loadFilters = () => { try { return JSON.parse(sessionStorage.getItem('brj:history-filters')) ?? {}; } catch { return {}; } };
const saveFilters = (f) => { try { sessionStorage.setItem('brj:history-filters', JSON.stringify(f)); } catch { /* ignore */ } };

export default async function render(el) {
  setHeader({ title: 'History' });
  const [sessions, meta] = await Promise.all([api('/sessions'), api('/meta')]);
  const f = { source: '', sector: '', from: '', to: '', score: '', ...loadFilters() };

  if (!sessions.length) {
    el.innerHTML = html`
      <h1 class="page-title">History</h1>
      <section class="section"><div class="empty">${raw(icon('history'))}
        <div class="empty-title">No sessions yet</div>Your sessions will be listed here once you read your first article.</div></section>`.toString();
    return;
  }

  // Only offer sectors that actually appear.
  const sectors = [...new Set(sessions.map((s) => s.tags?.sector).filter(Boolean))].sort();
  const select = (id, label, options, value) => html`
    <label class="filter"><span class="filter-label">${label}</span>
      <select class="input" id="${id}">${Object.entries(options).map(([v, t]) => html`<option value="${v}" ${v === value ? raw('selected') : ''}>${t}</option>`)}</select>
    </label>`;

  el.innerHTML = html`
    <h1 class="page-title">History</h1>
    <p class="page-lede">Every session you've started, newest first.</p>

    <section class="section">
      <div class="history-filters">
        ${select('f-source', 'Source', { '': 'All sources', ...SOURCE_LABELS }, f.source)}
        ${select('f-sector', 'Sector', { '': 'All sectors', ...Object.fromEntries(sectors.map((s) => [s, s])) }, f.sector)}
        ${select('f-score', 'Score', SCORE_BANDS, f.score)}
        <label class="filter"><span class="filter-label">From</span><input class="input" type="date" id="f-from" value="${f.from}"></label>
        <label class="filter"><span class="filter-label">To</span><input class="input" type="date" id="f-to" value="${f.to}"></label>
        <button class="btn btn-ghost btn-sm" type="button" id="f-clear">Clear</button>
      </div>
      <p class="hint" id="f-count" style="margin:14px 0 10px"></p>
      <div id="history-list"></div>
    </section>`.toString();

  function draw() {
    const shown = sessions.filter((s) =>
      (!f.source || s.source === f.source) &&
      (!f.sector || s.tags?.sector === f.sector) &&
      inBand(s, f.score) &&
      (!f.from || localDay(s.created_at) >= f.from) &&
      (!f.to || localDay(s.created_at) <= f.to));
    const scored = shown.filter((s) => s.overall_score != null);
    const avg = scored.length ? (scored.reduce((a, s) => a + s.overall_score, 0) / scored.length).toFixed(1) : null;
    $('#f-count', el).textContent = `${shown.length} of ${sessions.length} session${sessions.length === 1 ? '' : 's'}` +
      (avg ? ` · average score ${avg}` : '');
    $('#history-list', el).innerHTML = shown.length
      ? html`${shown.map((s) => sessionCard(s, { showDate: true }))}`.toString()
      : html`<div class="empty">No sessions match these filters.</div>`.toString();
    saveFilters(f);
  }

  const bind = (id, key) => $(`#${id}`, el).addEventListener('change', (e) => { f[key] = e.target.value; draw(); });
  bind('f-source', 'source');
  bind('f-sector', 'sector');
  bind('f-score', 'score');
  bind('f-from', 'from');
  bind('f-to', 'to');
  $('#f-clear', el).addEventListener('click', () => {
    Object.assign(f, { source: '', sector: '', from: '', to: '', score: '' });
    for (const s of $$('select, input', el)) s.value = '';
    draw();
  });

  draw();
}
