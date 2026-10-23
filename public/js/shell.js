// App chrome shared by every page: header, profile menu, stage tracker, dictionary drawer.
import { $, $$, html, raw, toast } from './lib/dom.js';
import { icon } from './lib/icons.js';
import { api } from './lib/api.js';
import { entryHtml, entrySkeleton } from './lib/entry.js';

export const STAGES = [
  { key: 'add', label: 'Add', hint: 'Article captured and tagged' },
  { key: 'write', label: 'Write', hint: '100–200 word comprehension' },
  { key: 'explore', label: 'Explore', hint: 'Related reading' },
  { key: 'interview', label: 'Interview', hint: '10 timed questions' },
  { key: 'verdict', label: 'Verdict', hint: 'Scores and feedback' },
];

// Called by each page on render. `pdf` shows the header download button.
// `ghost` is the oversized tone-on-tone word behind the page (defaults to the title's first word).
export function setHeader({ title = '', pdf = null, ghost } = {}) {
  document.title = title ? `${title} · Readout` : 'Readout';
  $('#content').dataset.ghost = (ghost ?? title.split(/\s+/)[0] ?? '').slice(0, 12);
  const pdfBtn = $('#pdf-btn');
  pdfBtn.hidden = !pdf;
  pdfBtn.onclick = pdf ? () => window.open(pdf, '_blank') : null;
}

/** Vertical stage tracker: completed filled in ink, current in black, the rest hairline. */
export function trackerHtml(stage, { times = {} } = {}) {
  const current = STAGES.findIndex((s) => s.key === stage);
  return html`<ol class="tracker" aria-label="Session stages">
    ${STAGES.map((s, i) => {
      const state = i < current || (stage === 'verdict' && i === current && times.verdictDone) ? 'done' : i === current ? 'current' : 'todo';
      return html`<li class="tracker-step" data-state="${state}" ${state === 'current' ? raw('aria-current="step"') : ''}>
        <span class="tracker-node">${state === 'done' ? raw(icon('check')) : state === 'current' ? raw(icon('arrow-right')) : ''}</span>
        <span class="tracker-text"><span class="tracker-title">${s.label}</span><span class="tracker-time">${times[s.key] ?? s.hint}</span></span>
      </li>`;
    })}
  </ol>`;
}

export function setActiveNav(path) {
  for (const a of $$('[data-nav]')) {
    const target = a.getAttribute('data-nav');
    const active = target === '/' ? path === '/' || path.startsWith('/session') : path.startsWith(target);
    if (active) a.setAttribute('aria-current', 'page');
    else a.removeAttribute('aria-current');
  }
}

export function setProfile({ name, email }) {
  const display = name?.trim() || 'Reader';
  $('#profile-name').textContent = display.split(/\s+/)[0];
  $('#profile-avatar').textContent = display.split(/\s+/).map((w) => w[0]).slice(0, 2).join('').toUpperCase();
  $('#menu-email').textContent = email ?? '';
}

/** Shows or hides the signed-in chrome (header, tab bar). */
export function showChrome(signedIn) {
  $('#app-header').hidden = !signedIn;
  $('#tabbar').hidden = !signedIn;
  $('#app-foot').hidden = !signedIn;
  document.body.classList.toggle('signed-out', !signedIn);
}

export function initProfileMenu() {
  const btn = $('#profile-btn');
  const menu = $('#profile-menu');
  const setOpen = (open) => { menu.hidden = !open; btn.setAttribute('aria-expanded', String(open)); };
  btn.addEventListener('click', (e) => { e.stopPropagation(); setOpen(menu.hidden); });
  document.addEventListener('click', (e) => { if (!menu.hidden && !menu.contains(e.target)) setOpen(false); });
  menu.addEventListener('click', (e) => { if (e.target.closest('a')) setOpen(false); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') setOpen(false); });
  $('#signout-btn').addEventListener('click', async () => {
    await api('/auth/signout', { method: 'POST' }).catch(() => {});
    location.href = '/signin';
  });
}

// ---------- Dictionary drawer ----------
export function initDictionary() {
  const app = $('#app');
  const panel = $('#dict');
  panel.innerHTML = html`
    <div class="dict-top">
      <div class="dict-title">
        <span>Dictionary</span>
        <button class="icon-btn" id="dict-close" type="button" aria-label="Close dictionary">${raw(icon('x'))}</button>
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
        Press <span class="kbd">/</span> from anywhere to open the dictionary.</p>
    </div>
    <div class="dict-foot">
      <a class="link-quiet" href="/glossary" data-link>${raw(icon('book-a'))}Open your glossary</a>
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

  // Entries can appear in the drawer or on the glossary page; handle their buttons everywhere.
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

  // "/" opens the dictionary unless the user is typing somewhere.
  document.addEventListener('keydown', (e) => {
    const t = e.target;
    const typing = t instanceof HTMLElement && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName));
    if (e.key === '/' && !typing && !e.ctrlKey && !e.metaKey && !e.altKey && !document.body.classList.contains('signed-out')) {
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
