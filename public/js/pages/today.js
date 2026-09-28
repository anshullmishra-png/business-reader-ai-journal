import { html, raw, $, $$, scoreClass } from '../lib/dom.js';
import { api } from '../lib/api.js';
import { icon } from '../lib/icons.js';
import { setHeader } from '../shell.js';
import { navigate } from '../router.js';
import { SOURCE_LABELS, STAGE_LABELS, fmtTime, fmtScore, plural } from '../lib/format.js';

function sessionCard(s) {
  const done = s.stage === 'verdict' && s.overall_score != null;
  return html`
    <a class="card session-card" href="/session/${s.id}" data-link>
      <div class="session-card-main">
        <div class="session-card-title">${s.title}</div>
        <div class="meta-row" style="margin-top:6px">
          <span>${SOURCE_LABELS[s.source]}</span><span>${plural(s.word_count, 'word')}</span><span>${fmtTime(s.created_at)}</span>
        </div>
      </div>
      ${done
        ? html`<div class="session-card-score ${scoreClass(s.overall_score)}">${fmtScore(s.overall_score)}</div>`
        : html`<span class="pill">${STAGE_LABELS[s.stage]}</span>`}
    </a>`;
}

export default async function render(el) {
  setHeader({ title: 'Today' });
  const date = new Date().toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long' });

  el.innerHTML = html`
    <h1 class="page-title">Today</h1>
    <div class="meta-row"><span>${date}</span></div>

    <section class="section">
      <div class="bento">
        <div class="bento-tabs" role="tablist" aria-label="How to add an article">
          <button class="pill pill-tab" role="tab" type="button" data-mode="url" aria-selected="true">Paste link</button>
          <button class="pill pill-tab" role="tab" type="button" data-mode="text" aria-selected="false">Paste text</button>
        </div>

        <form class="bento-body" id="form-url" data-panel="url">
          <div class="row">
            <label class="visually-hidden" for="add-url">Article link</label>
            <input class="input input-bare" id="add-url" name="url" type="url" required autocomplete="off"
                   placeholder="Paste an article link (The Arc, Entrackr, …)">
            <button class="btn btn-primary" type="submit">Start session ${raw(icon('arrow-right'))}</button>
          </div>
        </form>

        <form class="bento-body" id="form-text" data-panel="text" hidden>
          <div class="field">
            <label class="label" for="add-title">Title</label>
            <input class="input" id="add-title" name="title" required maxlength="300" placeholder="Article headline">
          </div>
          <div class="field">
            <label class="label" for="add-text">Article text</label>
            <textarea class="input textarea" id="add-text" name="text" required rows="7"
                      placeholder="Paste the full article text"></textarea>
          </div>
          <div class="field">
            <label class="label" for="add-link">Link <span class="hint">(optional)</span></label>
            <input class="input" id="add-link" name="url" type="url" placeholder="https://…">
          </div>
          <div class="row" style="justify-content:flex-end;margin-top:14px">
            <button class="btn btn-primary" type="submit">Start session ${raw(icon('arrow-right'))}</button>
          </div>
        </form>

        <div class="bento-status" id="add-status" aria-live="polite"></div>
      </div>
      <p class="hint" style="margin-top:16px">
        Reading on The Ken? Use the <strong>Send to Journal</strong> extension from the article tab:
        it sends the full text you can see while logged in. <a href="/extension" data-link>Install it</a>.
      </p>
    </section>

    <section class="section">
      <h2 class="section-heading">Today's sessions</h2>
      <div id="today-list"></div>
    </section>`.toString();

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
      ? html`${list.map(sessionCard)}`.toString()
      : html`<div class="empty">${raw(icon('notebook-pen'))}
          <div class="empty-title">Nothing read yet today</div>
          Paste a link above, or send an article from your browser with the extension.</div>`.toString();
  }
  await loadList();
  const timer = setInterval(loadList, 10000);
  const onFocus = () => loadList();
  window.addEventListener('focus', onFocus);

  $('#add-url', el).focus();
  return () => { clearInterval(timer); window.removeEventListener('focus', onFocus); };
}
