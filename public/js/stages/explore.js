// Stage 3: Explore. Related reading arrives in phase 5; for now this shows
// the background question generation that started when the comprehension locked.
import { html, raw, $ } from '../lib/dom.js';
import { api } from '../lib/api.js';
import { icon } from '../lib/icons.js';

function questionStatus(set) {
  if (!set || set.gen_status === 'pending') {
    return html`<p class="status-line">${raw(icon('loader-circle', 'spin'))}Preparing your 10 interview questions in the background…</p>`;
  }
  if (set.gen_status === 'failed') {
    return html`<div class="row"><p class="form-error" style="margin:0">Question generation failed.</p>
      <button class="btn btn-ghost btn-sm" type="button" data-action="retry-questions">${raw(icon('refresh-cw'))}Retry</button></div>`;
  }
  return html`<p class="status-line">${raw(icon('circle-check'))}Your 10 interview questions are ready.</p>`;
}

export function renderExplore(container, session, { onChange }) {
  let set = session.main_set;
  let timer = null;

  const draw = () => {
    container.innerHTML = html`
      <h2 class="section-heading">Explore</h2>
      <div class="card">
        ${questionStatus(set)}
        <p class="hint" style="margin-top:10px">Related reading and the interview arrive in the next build phases.</p>
      </div>`.toString();
  };

  const poll = async () => {
    const s = await api(`/sessions/${session.id}`).catch(() => null);
    if (s) { set = s.main_set; onChange?.(s); }
    draw();
    if (set?.gen_status === 'pending') timer = setTimeout(poll, 3000);
  };

  container.addEventListener('click', async (e) => {
    if (e.target.closest('[data-action="retry-questions"]')) {
      const s = await api(`/sessions/${session.id}/questions/retry`, { method: 'POST' });
      set = s.main_set;
      draw();
      clearTimeout(timer);
      timer = setTimeout(poll, 3000);
    }
  });

  draw();
  if (!set || set.gen_status === 'pending') timer = setTimeout(poll, 3000);
  return () => clearTimeout(timer);
}
