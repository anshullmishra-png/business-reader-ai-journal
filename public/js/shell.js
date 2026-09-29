// App chrome shared by every page: header, stepper, sidebar profile, dictionary panel.
import { $, $$, html, raw, esc, toast } from './lib/dom.js';
import { icon } from './lib/icons.js';
import { api } from './lib/api.js';
import { entryHtml, entrySkeleton } from './lib/entry.js';

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
    if (term) lookupTerm(term);
  });

  // Entries can appear in the panel or on the glossary page; handle their buttons everywhere.
  document.addEventListener('click', async (e) => {
    const rel = e.target.closest('[data-lookup]');
    if (rel) {
      setOpen(true);
      $('#dict-input').value = rel.dataset.lookup;
      lookupTerm(rel.dataset.lookup);
      return;
    }
    const more = e.target.closest('[data-more-examples]');
    if (more) {
      more.disabled = true;
      more.innerHTML = `${icon('loader-circle', 'spin')}Finding more examples…`;
      try {
        const t = await api(`/glossary/${more.dataset.moreExamples}/more-examples`, { method: 'POST' });
        const article = more.closest('.entry');
        const compact = !article.querySelector('.entry-term');
        article.outerHTML = entryHtml(t, { compact }).toString();
      } catch (err) {
        toast(err.message);
        more.disabled = false;
        more.innerHTML = `${icon('plus')}More examples`;
      }
    }
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

// Looks a term up: saved terms come back instantly with no AI call.
let lookupSeq = 0;
export async function lookupTerm(term) {
  const seq = ++lookupSeq;
  const body = $('#dict-body');
  // Show the skeleton only if the answer isn't instant (i.e. it's a new term).
  const skeletonTimer = setTimeout(() => {
    if (seq === lookupSeq) body.innerHTML = entrySkeleton(term).toString();
  }, 150);
  const sessionId = Number(location.pathname.match(/^\/session\/(\d+)/)?.[1]) || null;
  try {
    const { term: t, cached } = await api('/glossary/lookup', { method: 'POST', body: { term, session_id: sessionId } });
    if (seq !== lookupSeq) return;
    body.innerHTML = html`
      ${entryHtml(t)}
      <p class="hint entry-saved">${raw(icon(cached ? 'book-a' : 'circle-check'))}${cached ? 'From your glossary' : 'Saved to your glossary'}</p>`.toString();
    body.scrollTop = 0;
  } catch (err) {
    if (seq !== lookupSeq) return;
    body.innerHTML = html`<p class="dict-empty">${err.message}</p>`.toString();
  } finally {
    clearTimeout(skeletonTimer);
  }
}
