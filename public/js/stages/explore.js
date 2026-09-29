// Stage 3: Explore. Related reading (search links only) while the interview
// questions finish generating in the background.
import { html, raw, $, toast } from '../lib/dom.js';
import { api } from '../lib/api.js';
import { icon } from '../lib/icons.js';

const googleUrl = (q) => `https://www.google.com/search?q=${encodeURIComponent(q)}`;

function relatedView(s) {
  if (s.related_status === 'failed') {
    return html`<div class="card row">
      <p class="form-error" style="margin:0">Related reading couldn't be generated.</p>
      <button class="btn btn-ghost btn-sm" type="button" data-action="retry-related">${raw(icon('refresh-cw'))}Retry</button>
    </div>`;
  }
  if (s.related_status !== 'ready') {
    return html`
      <p class="status-line" style="margin-bottom:12px">${raw(icon('loader-circle', 'spin'))}Finding the threads worth pulling…</p>
      ${[80, 60, 70].map((w) => html`<div class="card read-item">
        <div class="skeleton" style="width:20px;height:20px;border-radius:6px"></div>
        <div style="flex:1"><div class="skeleton skeleton-line" style="width:${w}%;height:18px"></div>
          <div class="skeleton skeleton-line w-80"></div></div></div>`)}`;
  }
  return html`${s.related.map((it) => html`
    <div class="card read-item ${it.done ? raw('is-done') : ''}">
      <label class="read-check">
        <input type="checkbox" data-item="${it.id}" ${it.done ? raw('checked') : ''}>
        <span class="visually-hidden">Mark "${it.title}" as done</span>
      </label>
      <div class="read-body">
        <span class="tag">${it.category}</span>
        <div class="read-title">${it.title}</div>
        <p class="read-why">${it.why}</p>
        <div class="read-queries">
          ${it.queries.map((q) => html`<a class="query-link" href="${googleUrl(q)}" target="_blank" rel="noopener noreferrer">
            ${raw(icon('search'))}<span>${q}</span>${raw(icon('external-link'))}</a>`)}
        </div>
      </div>
    </div>`)}`;
}

function startBar(s) {
  const set = s.main_set;
  if (set?.gen_status === 'failed') {
    return html`<div class="row"><p class="form-error" style="margin:0">Question generation failed.</p>
      <button class="btn btn-ghost btn-sm" type="button" data-action="retry-questions">${raw(icon('refresh-cw'))}Retry</button></div>`;
  }
  const ready = set?.gen_status === 'ready';
  return html`
    <p class="status-line">${ready
      ? html`${raw(icon('circle-check'))}Your 10 questions are ready. ${raw('&nbsp;')}No going back once you start.`
      : html`${raw(icon('loader-circle', 'spin'))}Preparing your 10 interview questions…`}</p>
    <button class="btn btn-primary" type="button" data-action="start" ${ready ? '' : raw('disabled')}>
      I'm ready. Start the interview ${raw(icon('arrow-right'))}</button>`;
}

export function renderExplore(container, session, { onChange }) {
  let s = session;
  let timer = null;

  container.innerHTML = html`
    <h2 class="section-heading">Explore</h2>
    <p class="hint write-intro">Pull a few threads before the interview. Each link opens a Google search in a new tab.</p>
    <div id="related"></div>
    <div class="start-bar card" id="start-bar"></div>`.toString();

  const draw = () => {
    $('#related', container).innerHTML = relatedView(s).toString();
    $('#start-bar', container).innerHTML = startBar(s).toString();
  };

  const needsPoll = () => s.related_status === 'pending' || s.main_set?.gen_status === 'pending';
  const schedule = () => { clearTimeout(timer); if (needsPoll()) timer = setTimeout(poll, 3000); };
  const update = (fresh) => { s = fresh; onChange?.(fresh); draw(); schedule(); };

  async function poll() {
    const fresh = await api(`/sessions/${s.id}`).catch(() => null);
    if (fresh) update(fresh); else schedule();
  }

  container.addEventListener('change', async (e) => {
    const itemId = e.target.dataset.item;
    if (!itemId) return;
    try {
      update(await api(`/sessions/${s.id}/related/${itemId}`, { method: 'PATCH', body: { done: e.target.checked } }));
    } catch (err) {
      toast(err.message);
    }
  });

  container.addEventListener('click', async (e) => {
    const action = e.target.closest('[data-action]')?.dataset.action;
    if (!action) return;
    try {
      if (action === 'retry-related') update(await api(`/sessions/${s.id}/related/retry`, { method: 'POST' }));
      if (action === 'retry-questions') update(await api(`/sessions/${s.id}/questions/retry`, { method: 'POST' }));
      if (action === 'start') {
        e.target.closest('button').disabled = true;
        const fresh = await api(`/sessions/${s.id}/interview/start`, { method: 'POST' });
        onChange?.(fresh, { stageChanged: true });
      }
    } catch (err) {
      toast(err.message);
      if (err.status === 409) poll();
    }
  });

  draw();
  schedule();
  return () => clearTimeout(timer);
}
