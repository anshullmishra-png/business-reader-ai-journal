// App chrome shared by every page: header, stepper, sidebar profile, dictionary panel.
import { $, $$, html, raw, esc } from './lib/dom.js';
import { icon } from './lib/icons.js';

export const STAGES = [
  { key: 'add', label: 'Add' },
  { key: 'write', label: 'Write' },
  { key: 'explore', label: 'Explore' },
  { key: 'interview', label: 'Interview' },
  { key: 'verdict', label: 'Verdict' },
];

// Called by each page on render. stage = current stage key, or null to hide the stepper.
export function setHeader({ title = '', pill = null, stage = null, pdf = null } = {}) {
  $('#header-title').textContent = title;
  document.title = title ? `${title} · Business Reads Journal` : 'Business Reads Journal';

  const pillEl = $('#header-pill');
  pillEl.hidden = !pill;
  pillEl.textContent = pill ?? '';

  const stepper = $('#stepper');
  stepper.hidden = !stage;
  if (stage) {
    const current = STAGES.findIndex((s) => s.key === stage);
    stepper.innerHTML = STAGES.map((s, i) => {
      const state = i < current ? 'done' : i === current ? 'current' : 'todo';
      const dot = state === 'done' ? icon('check') : String(i + 1);
      return `${i ? '<li class="step-sep" aria-hidden="true"></li>' : ''}
        <li class="step" data-state="${state}" ${state === 'current' ? 'aria-current="step"' : ''}>
          <span class="step-dot">${dot}</span><span class="step-label">${esc(s.label)}</span>
        </li>`;
    }).join('');
  }

  const pdfBtn = $('#pdf-btn');
  pdfBtn.disabled = !pdf;
  pdfBtn.onclick = pdf ? () => window.open(pdf, '_blank') : null;
}

export function setActiveNav(path) {
  for (const a of $$('[data-nav]')) {
    const target = a.getAttribute('data-nav');
    const active = target === '/' ? path === '/' || path.startsWith('/session') : path.startsWith(target);
    if (active) a.setAttribute('aria-current', 'page');
    else a.removeAttribute('aria-current');
  }
}

export function setProfile({ name, demo }) {
  const display = name?.trim() || 'Reader';
  $('#profile-name').textContent = display;
  $('#profile-avatar').textContent = display
    .split(/\s+/).map((w) => w[0]).slice(0, 2).join('').toUpperCase();
  $('#profile-meta').innerHTML = demo
    ? '<span class="pill pill-dark" style="height:18px;font-size:10px">Demo</span>'
    : 'Local · private';
}

// ---------- Dictionary panel (lookups arrive in phase 8) ----------
export function initDictionary() {
  const app = $('#app');
  const panel = $('#dict');
  panel.innerHTML = html`
    <div class="dict-top">
      <div class="dict-title">
        <span>Dictionary</span>
        <button class="icon-btn dict-close" id="dict-close" type="button" aria-label="Close dictionary">${raw(icon('x'))}</button>
      </div>
      <form class="dict-input-wrap" id="dict-form" role="search">
        <label class="visually-hidden" for="dict-input">Look up a business term</label>
        ${raw(icon('search'))}
        <input class="input dict-input" id="dict-input" name="term" autocomplete="off"
               placeholder="Look up a term…" maxlength="80">
      </form>
    </div>
    <div class="dict-body" id="dict-body" aria-live="polite">
      <p class="dict-empty">Type a term like <em>contribution margin</em> or <em>take rate</em>.
        Press <span class="kbd">/</span> from anywhere to jump here.</p>
    </div>
    <div class="dict-foot">
      <a class="link-quiet" href="/glossary" data-link>${raw(icon('book-a'))}Open glossary</a>
    </div>`.toString();

  const setOpen = (open) => { app.dataset.dictOpen = String(open); };
  $('#dict-toggle').addEventListener('click', () => { setOpen(true); $('#dict-input').focus(); });
  $('#dict-close').addEventListener('click', () => setOpen(false));
  $('#dict-scrim').addEventListener('click', () => setOpen(false));
  $('#dict-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const term = $('#dict-input').value.trim();
    if (!term) return;
    $('#dict-body').innerHTML = html`<p class="dict-empty">Lookups for “${term}” arrive in a later build phase.</p>`.toString();
  });

  // "/" focuses the dictionary unless the user is typing somewhere.
  document.addEventListener('keydown', (e) => {
    const t = e.target;
    const typing = t instanceof HTMLElement && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName));
    if (e.key === '/' && !typing && !e.ctrlKey && !e.metaKey && !e.altKey) {
      e.preventDefault();
      setOpen(true);
      $('#dict-input').focus();
    }
    if (e.key === 'Escape' && app.dataset.dictOpen === 'true') setOpen(false);
  });
}
