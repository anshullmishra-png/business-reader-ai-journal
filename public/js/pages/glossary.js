import { html, raw, $, toast } from '../lib/dom.js';
import { api } from '../lib/api.js';
import { icon } from '../lib/icons.js';
import { setHeader } from '../shell.js';
import { entryHtml } from '../lib/entry.js';
import { fmtDate } from '../lib/format.js';
import { drawing } from '../lib/drawings.js';

function firstSentence(s) {
  const m = String(s).match(/^.*?[.!?](\s|$)/);
  return m ? m[0].trim() : s;
}

function boxesBar(boxes) {
  const total = Object.values(boxes).reduce((a, b) => a + b, 0) || 1;
  return html`<div class="boxes" aria-label="Leitner boxes">
    ${[1, 2, 3, 4, 5].map((b) => html`<div class="box-col">
      <div class="box-bar"><div class="box-fill" style="height:${Math.round((boxes[b] / total) * 100)}%"></div></div>
      <span class="box-n">${boxes[b]}</span><span class="box-label">Box ${b}</span></div>`)}
  </div>`;
}

// ---------- Quiz ----------
function runQuiz(el, quiz) {
  let i = 0;
  let right = 0;
  const moves = [];

  async function grade(item, correct) {
    try {
      const r = await api(`/glossary/${item.id}/review`, { method: 'POST', body: { correct } });
      moves.push({ term: item.term, from: item.box, to: r.box });
    } catch (err) {
      toast(err.message);
    }
    if (correct) right++;
    i++;
    draw();
  }

  function draw() {
    if (i >= quiz.items.length) {
      el.innerHTML = html`
        <div class="card quiz-card">
          <div class="q-count">Quiz complete</div>
          <p class="quiz-score">${right} / ${quiz.items.length}</p>
          <ul class="quiz-moves">${moves.map((m) => html`<li>${m.term}: box ${m.from} → ${m.to}</li>`)}</ul>
          <button class="btn btn-primary" type="button" data-quiz-exit>Back to glossary</button>
        </div>`.toString();
      return;
    }
    const item = quiz.items[i];
    const head = html`<div class="q-count">Card ${i + 1} of ${quiz.items.length} · Box ${item.box} · ${item.kind === 'mcq' ? 'Pick the definition' : 'Flashcard'}</div>
      <h2 class="quiz-term">${item.term}</h2>`;

    if (item.kind === 'flashcard') {
      el.innerHTML = html`<div class="card quiz-card">${head}
        <div id="reveal-area"><button class="btn btn-primary" type="button" data-reveal>Show definition</button>
        <p class="hint" style="margin-top:10px">Say it to yourself first, then check.</p></div></div>`.toString();
      $('[data-reveal]', el).addEventListener('click', () => {
        $('#reveal-area', el).innerHTML = html`<p class="quiz-def">${item.definition}</p>
          <div class="row" style="margin-top:16px">
            <button class="btn btn-ghost" type="button" data-grade="0">${raw(icon('x'))}Missed it</button>
            <button class="btn btn-primary" type="button" data-grade="1">${raw(icon('check'))}Got it</button>
          </div>`.toString();
        for (const b of el.querySelectorAll('[data-grade]')) b.addEventListener('click', () => grade(item, b.dataset.grade === '1'));
      });
      return;
    }

    el.innerHTML = html`<div class="card quiz-card">${head}
      <div class="options">${item.options.map((o, k) => html`<button type="button" class="option" data-pick="${k}">
        <span class="option-key">${k + 1}</span><span>${o}</span></button>`)}</div>
      <div id="quiz-next"></div></div>`.toString();
    for (const b of el.querySelectorAll('[data-pick]')) {
      b.addEventListener('click', () => {
        const pick = Number(b.dataset.pick);
        const ok = pick === item.correct;
        for (const o of el.querySelectorAll('[data-pick]')) {
          o.disabled = true;
          const k = Number(o.dataset.pick);
          o.dataset.state = k === item.correct ? 'correct' : k === pick ? 'wrong' : '';
        }
        $('#quiz-next', el).innerHTML = html`<div class="row" style="margin-top:16px;justify-content:space-between">
          <strong class="${ok ? 'score-high' : 'score-low'}">${ok ? 'Right.' : 'Wrong.'}</strong>
          <button class="btn btn-primary" type="button" data-next>Next ${raw(icon('arrow-right'))}</button></div>`.toString();
        $('[data-next]', el).addEventListener('click', () => grade(item, ok));
      });
    }
  }

  draw();
}

// ---------- Page ----------
export default async function render(el) {
  setHeader({ title: 'Glossary' });
  const state = { q: '', sort: 'az', sector: '', open: null };
  let data = await api('/glossary');

  el.innerHTML = html`
    <h1 class="page-title">Glossary</h1>
    <p class="page-lede">Every term you've looked up. Saved terms open instantly, with no AI call.</p>
    <section class="section" id="glossary-main"></section>`.toString();
  const main = $('#glossary-main', el);

  function drawList() {
    const { terms, boxes, sectors } = data;
    main.innerHTML = html`
      <div class="card quiz-intro">
        <div>
          <div class="won-title">Vocab quiz</div>
          <p class="hint">Flashcards and pick-the-definition, built from your own glossary. Right answers move a term up a box; misses send it back to box 1.</p>
          <button class="btn btn-primary" type="button" data-start-quiz ${Object.values(boxes).some(Boolean) ? '' : raw('disabled')}>${raw(icon('target'))}Start quiz</button>
        </div>
        ${boxesBar(boxes)}
      </div>

      <div class="glossary-filters">
        <div class="dict-input-wrap" style="flex:1">
          ${raw(icon('search'))}
          <label class="visually-hidden" for="g-search">Search glossary</label>
          <input class="input dict-input" id="g-search" placeholder="Search your glossary" value="${state.q}">
        </div>
        <label class="visually-hidden" for="g-sort">Sort</label>
        <select class="input" id="g-sort">
          <option value="az" ${state.sort === 'az' ? raw('selected') : ''}>A–Z</option>
          <option value="count" ${state.sort === 'count' ? raw('selected') : ''}>Most looked up</option>
          <option value="newest" ${state.sort === 'newest' ? raw('selected') : ''}>Newest</option>
        </select>
        <label class="visually-hidden" for="g-sector">Sector</label>
        <select class="input" id="g-sector">
          <option value="">All sectors</option>
          ${sectors.map((s) => html`<option ${s === state.sector ? raw('selected') : ''}>${s}</option>`)}
        </select>
      </div>

      <div id="g-list">
        ${terms.length ? terms.map((t) => html`
          <div class="card g-item ${state.open === t.id ? raw('is-open') : ''}">
            <button class="g-head" type="button" data-open="${t.id}" aria-expanded="${String(state.open === t.id)}">
              <span class="g-term">${t.term}</span>
              <span class="g-meta">${t.lookup_count}× · ${fmtDate(t.created_at)}</span>
            </button>
            ${state.open === t.id
              ? html`${entryHtml(t, { compact: true })}
                <button class="btn btn-ghost btn-sm" type="button" data-delete="${t.id}" style="margin-top:12px">${raw(icon('trash-2'))}Remove from glossary</button>`
              : html`<p class="g-snippet">${firstSentence(t.definition)}</p>`}
          </div>`)
        : html`<div class="empty">${state.q || state.sector ? drawing('search') : drawing('book')}
            <div class="empty-title">${state.q || state.sector ? 'No matching terms' : 'Your glossary is empty'}</div>
            ${state.q || state.sector ? 'Try another search or sector.' : 'Look up a term in the dictionary panel (press /) and it will be saved here.'}</div>`}
      </div>`.toString();

    const search = $('#g-search', el);
    let debounce = null;
    search.addEventListener('input', () => {
      clearTimeout(debounce);
      debounce = setTimeout(() => { state.q = search.value.trim(); reload(true); }, 200);
    });
    $('#g-sort', el).addEventListener('change', (e) => { state.sort = e.target.value; reload(); });
    $('#g-sector', el).addEventListener('change', (e) => { state.sector = e.target.value; reload(); });
  }

  async function reload(keepFocus = false) {
    const p = new URLSearchParams({ sort: state.sort });
    if (state.q) p.set('q', state.q);
    if (state.sector) p.set('sector', state.sector);
    data = await api(`/glossary?${p}`);
    drawList();
    if (keepFocus) {
      const s = $('#g-search', el);
      s.focus();
      s.setSelectionRange(s.value.length, s.value.length);
    }
  }

  main.addEventListener('click', async (e) => {
    const open = e.target.closest('[data-open]');
    if (open) {
      const id = Number(open.dataset.open);
      state.open = state.open === id ? null : id;
      drawList();
      return;
    }
    const del = e.target.closest('[data-delete]');
    if (del) {
      if (!confirm('Remove this term from your glossary? Its quiz progress is removed too.')) return;
      await api(`/glossary/${del.dataset.delete}`, { method: 'DELETE' });
      state.open = null;
      toast('Removed');
      reload();
      return;
    }
    if (e.target.closest('[data-start-quiz]')) {
      const quiz = await api('/glossary/quiz?size=10');
      if (!quiz.items.length) { toast('Look up a few terms first.'); return; }
      setHeader({ title: 'Vocab quiz' });
      runQuiz(main, quiz);
      return;
    }
    if (e.target.closest('[data-quiz-exit]')) {
      setHeader({ title: 'Glossary' });
      reload();
    }
  });

  drawList();
}
