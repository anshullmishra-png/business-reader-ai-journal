import { html, raw, $, $$ } from '../lib/dom.js';
import { api } from '../lib/api.js';
import { icon } from '../lib/icons.js';
import { setHeader, STAGES } from '../shell.js';
import { navigate } from '../router.js';
import { appState, loadMe } from '../app.js';
import { sessionCard } from '../lib/sessionCard.js';
import { drawing } from '../lib/drawings.js';

function greeting() {
  const h = new Date().getHours();
  return h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening';
}

// The day's numbers. The streak is shown as a fact only; the app never nudges you about it.
function stats(sum) {
  const items = [
    ['calendar', 'This week', sum.week, sum.week === 1 ? 'article' : 'articles'],
    ['flame', 'Streak', sum.streak, sum.streak === 1 ? 'day' : 'days'],
    ['gauge', 'Difficulty', sum.difficulty, 'of 10'],
    ['layers', 'All time', sum.total, sum.total === 1 ? 'session' : 'sessions'],
  ];
  return html`<div class="stat-grid">${items.map(([ic, label, n, unit]) => html`
    <div class="card stat-card">
      <div class="stat-label">${raw(icon(ic))}${label}</div>
      <div class="stat-value"><span class="stat-num">${n}</span><span class="stat-unit">${unit}</span></div>
    </div>`)}</div>`;
}

export default async function render(el) {
  setHeader({ title: 'Today' });
  const [sum] = await Promise.all([
    api('/summary').catch(() => ({ total: 0, week: 0, today: 0, streak: 0, difficulty: 3 })),
    loadMe().catch(() => null),
  ]);
  // One new article a day: once it's started, the add form gives way to a note.
  const ai = appState.ai ?? {};
  const doneForToday = ai.articles_today >= ai.articles_per_day;
  const budgetSpent = ai.app_spend_today_usd + 0.06 > ai.app_budget_usd;
  const first = appState.user?.name?.split(/\s+/)[0];
  const date = new Date().toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long' });

  el.innerHTML = html`
    <header class="page-head">
      <div class="label">${date}</div>
      <h1 class="page-title">${greeting()}${first ? `, ${first}` : ''}</h1>
      <p class="page-lede">Add today's article, write your brief, then face the interviewer.</p>
    </header>

    ${stats(sum)}

    <div class="bento">
      <div class="stack">
        <section class="card hard add-card">
          <div class="card-head">
            <h2 class="card-title">${raw(icon('plus'))}Start a session</h2>
            <div class="segmented" role="tablist" aria-label="How to add an article">
              <button role="tab" type="button" data-mode="url" aria-selected="true">Paste link</button>
              <button role="tab" type="button" data-mode="text" aria-selected="false">Paste text</button>
            </div>
          </div>

          <form id="form-url" data-panel="url">
            <div class="row">
              <label class="visually-hidden" for="add-url">Article link</label>
              <input class="input" id="add-url" name="url" type="url" required autocomplete="off"
                     placeholder="Paste an article link (The Arc, Entrackr, …)">
              <button class="btn btn-primary" type="submit">Start ${raw(icon('arrow-right'))}</button>
            </div>
          </form>

          <form id="form-text" data-panel="text" hidden>
            <div class="field">
              <label class="field-label" for="add-title">Title</label>
              <input class="input" id="add-title" name="title" required maxlength="300" placeholder="Article headline">
            </div>
            <div class="field">
              <label class="field-label" for="add-text">Article text</label>
              <textarea class="input textarea" id="add-text" name="text" required rows="7"
                        placeholder="Paste the full article text"></textarea>
            </div>
            <div class="field">
              <label class="field-label" for="add-link">Link <span class="hint">(optional)</span></label>
              <input class="input" id="add-link" name="url" type="url" placeholder="https://…">
            </div>
            <div class="row row-end">
              <button class="btn btn-primary" type="submit">Start session ${raw(icon('arrow-right'))}</button>
            </div>
          </form>

          <div id="add-status" aria-live="polite"></div>
        </section>

        <section class="card inverted list-card">
          <div class="card-head">
            <h2 class="card-title">${raw(icon('sun'))}Today's sessions</h2>
            <a class="link-quiet" href="/history" data-link>All history ${raw(icon('chevron-right'))}</a>
          </div>
          <div id="today-list"></div>
        </section>
      </div>

      <div class="stack">
        <section class="card">
          <h2 class="card-title">${raw(icon('target'))}How a session works</h2>
          <ol class="tracker tracker-static">
            ${STAGES.map((s) => html`<li class="tracker-step" data-state="todo">
              <span class="tracker-node"></span>
              <span class="tracker-text"><span class="tracker-title">${s.label}</span><span class="tracker-time">${s.hint}</span></span>
            </li>`)}
          </ol>
        </section>
        <section class="card card-soft">
          <h2 class="card-title">${raw(icon('puzzle'))}Reading a paywalled story?</h2>
          <p>The <strong>Send to Readout</strong> extension sends the full text you can see while logged in, straight from the article tab.</p>
          <div><a class="btn btn-secondary" href="/extension" data-link>Install the extension</a></div>
        </section>
      </div>
    </div>`.toString();

  if (doneForToday || budgetSpent) {
    for (const node of $$('.add-card form, .add-card .segmented', el)) node.hidden = true;
    $('.add-card .card-title', el).lastChild.textContent = doneForToday ? "Today's article is in" : 'Paused for today';
    $('#add-status', el).innerHTML = html`<p class="land-pitch">${doneForToday
      ? 'One article a day keeps every interview sharp. Finish today’s session; the next article unlocks tomorrow.'
      : 'Readout has used today’s AI budget. New articles unlock again after midnight UTC.'}</p>`.toString();
  }

  // ---- Tabs ----
  const setMode = (mode) => {
    for (const t of $$('[data-mode]', el)) t.setAttribute('aria-selected', String(t.dataset.mode === mode));
    for (const p of $$('[data-panel]', el)) p.hidden = p.dataset.panel !== mode;
    $('#add-status', el).innerHTML = '';
    (mode === 'url' ? $('#add-url', el) : $('#add-title', el)).focus();
  };
  for (const t of $$('[data-mode]', el)) t.addEventListener('click', () => setMode(t.dataset.mode));

  // ---- Submit ----
  const status = (content) => { $('#add-status', el).innerHTML = content.toString(); };
  const busy = (form, on) => { for (const b of $$('button, input, textarea', form)) b.disabled = on; };

  async function submit(form, body, waitingText) {
    busy(form, true);
    status(html`<p class="status-line">${raw(icon('loader-circle', 'spin'))}${waitingText}</p>`);
    try {
      const { id } = await api('/sessions', { method: 'POST', body });
      navigate(`/session/${id}`);
    } catch (err) {
      busy(form, false);
      if (err.data?.code === 'too_short' && body.mode === 'url') {
        status(html`
          <p class="form-error">${err.message}</p>
          <button class="btn btn-ghost btn-sm" type="button" id="switch-to-text">Paste the text instead</button>`);
        $('#switch-to-text', el).addEventListener('click', () => {
          setMode('text');
          $('#add-link', el).value = body.url;
          if (err.data.title) $('#add-title', el).value = err.data.title;
          $('#add-text', el).focus();
        });
      } else {
        status(html`<p class="form-error">${err.status === 400 ? 'Check the link and try again.' : err.message}</p>`);
      }
    }
  }

  $('#form-url', el).addEventListener('submit', (e) => {
    e.preventDefault();
    submit(e.target, { mode: 'url', url: $('#add-url', el).value.trim() }, 'Fetching and reading the article…');
  });
  $('#form-text', el).addEventListener('submit', (e) => {
    e.preventDefault();
    const f = new FormData(e.target);
    submit(e.target, {
      mode: 'text',
      title: String(f.get('title')),
      text: String(f.get('text')),
      url: String(f.get('url') ?? '').trim(),
    }, 'Saving…');
  });
  // Ctrl+Enter submits the text form from the textarea.
  $('#add-text', el).addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && e.ctrlKey) $('#form-text', el).requestSubmit();
  });

  // ---- Today's sessions (refreshes so extension captures appear) ----
  async function loadList() {
    const list = await api('/sessions?scope=today').catch(() => null);
    if (!list) return;
    $('#today-list', el).innerHTML = list.length
      ? html`<div class="list">${list.map(sessionCard)}</div>`.toString()
      : html`<div class="empty empty-compact">${drawing('newspaper')}
          <div class="empty-title">Nothing read yet today</div>
          Paste a link above, or send an article from your browser with the extension.</div>`.toString();
  }
  await loadList();
  const timer = setInterval(loadList, 15000);
  const onFocus = () => loadList();
  window.addEventListener('focus', onFocus);

  if (!doneForToday && !budgetSpent) $('#add-url', el).focus();
  return () => { clearInterval(timer); window.removeEventListener('focus', onFocus); };
}
