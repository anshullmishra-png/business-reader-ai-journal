// Sign in / create an account, set as the journal's poster. New accounts need the
// invite code shared with testers.
import { html, raw, $ } from '../lib/dom.js';
import { api } from '../lib/api.js';
import { icon } from '../lib/icons.js';
import { setHeader } from '../shell.js';
import { loadMe } from '../app.js';
import { navigate } from '../router.js';

// The daily loop, printed as a timetable.
const LOOP = [
  ['01 · Add', 'Send the article', 'Capture it from your browser tab, or paste a link or the text.', '1 min'],
  ['02 · Write', 'Condense it', '100–200 words in your own words: what happened, why it matters, how the money works.', '10 min'],
  ['03 · Explore', 'Pull the threads', 'Competitors, the sector, the founders, the core concept.', '15 min'],
  ['04 · Interview', 'Face the interviewer', 'Ten timed questions, one at a time, no going back.', '10 Qs'],
  ['05 · Verdict', 'Take the score', 'A blunt mark out of ten, model answers, and two things to fix next.', '/10'],
];

export default async function render(el) {
  const signup = location.pathname === '/signup';
  setHeader({ title: signup ? 'Create your account' : 'Sign in' });
  const next = new URLSearchParams(location.search).get('next');
  const safeNext = next?.startsWith('/') && !next.startsWith('//') ? next : '/';
  const qs = next ? `?next=${encodeURIComponent(next)}` : '';
  const year = new Date().getFullYear();

  el.innerHTML = html`
    <div class="landing">
      <section class="land-bar">
        <span class="brand-name">Business Reads</span>
        <span class="meta-mid">Daily reading · Interview practice</span>
        <a class="btn btn-primary" href="${signup ? `/signin${qs}` : `/signup${qs}`}" data-link>${signup ? 'Sign in' : 'Create account'}</a>
      </section>

      <section class="land-hero">
        <div class="land-ghost" aria-hidden="true">Reads</div>
        <h1 class="auth-word"><span>Business</span><span>Reads</span></h1>
        <dl class="land-meta">
          <div><dt>Format</dt><dd>One article a day</dd></div>
          <div><dt>Practice</dt><dd>Chief of Staff interviews</dd></div>
          <div><dt>Scoring</dt><dd>Out of 10, no flattery</dd></div>
          <div><dt>Edition</dt><dd>${year}</dd></div>
        </dl>
      </section>

      <section class="land-main">
        <div class="card hard">
          <p class="land-pitch">Turn your daily business reading into practice for Chief of Staff and Founder's Office interviews.</p>
          <div class="land-rows">
            <div class="land-row"><span class="display">Read<span>Write</span></span><span class="mono">${raw(icon('arrow-up-right'))}10 min</span></div>
            <div class="land-row"><span class="display">Interview<span>Verdict</span></span><span class="mono">${raw(icon('arrow-up-right'))}10 Qs</span></div>
          </div>
        </div>

        <form class="auth-card" id="auth-form" novalidate>
          <span class="label">${signup ? 'New account' : 'Welcome back'}</span>
          <h2 class="auth-title">${signup ? 'Create your journal' : 'Sign in'}</h2>
          ${signup ? html`<div class="field">
            <label class="field-label" for="name">Your name</label>
            <input class="input" id="name" name="name" autocomplete="name" maxlength="60" required>
          </div>` : ''}
          <div class="field">
            <label class="field-label" for="email">Email</label>
            <input class="input" id="email" name="email" type="email" autocomplete="email" required>
          </div>
          <div class="field">
            <label class="field-label" for="password">Password</label>
            <input class="input" id="password" name="password" type="password" minlength="8" required
                   autocomplete="${signup ? 'new-password' : 'current-password'}">
            ${signup ? html`<span class="hint">At least 8 characters.</span>` : ''}
          </div>
          ${signup ? html`<div class="field">
            <label class="field-label" for="invite">Invite code</label>
            <input class="input" id="invite" name="invite" autocomplete="off" required>
            <span class="hint">Ask the person who shared this link with you.</span>
          </div>` : ''}
          <p class="form-error" id="auth-error" role="alert" hidden></p>
          <button class="btn btn-primary btn-block" type="submit" id="auth-submit">${signup ? 'Create account' : 'Sign in'}</button>
          <p class="auth-switch hint">${signup
            ? html`Already have an account? <a href="/signin${qs}" data-link>Sign in</a>`
            : html`New here? <a href="/signup${qs}" data-link>Create an account</a>`}</p>
        </form>
      </section>

      <section class="land-loop inverted">
        <span class="label page-kicker">The daily loop</span>
        <h2 class="page-title">Five stages, every article</h2>
        <div class="timetable">
          ${LOOP.map(([time, title, sub, tag]) => html`<div class="tt-row">
            <span class="tt-time">${time}</span>
            <div class="tt-main"><div class="tt-title">${title}</div><p class="tt-sub">${sub}</p></div>
            <span class="tt-tag">${tag}</span>
          </div>`)}
        </div>
      </section>
    </div>`.toString();

  const form = $('#auth-form', el);
  const errorEl = $('#auth-error', el);
  const submit = $('#auth-submit', el);
  form.querySelector('input').focus({ preventScroll: true });

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const body = Object.fromEntries(new FormData(form));
    errorEl.hidden = true;
    submit.disabled = true;
    submit.innerHTML = `${icon('loader-circle', 'spin')}${signup ? 'Creating…' : 'Signing in…'}`;
    try {
      await api(signup ? '/auth/signup' : '/auth/signin', { method: 'POST', body });
      await loadMe();
      navigate(safeNext, { replace: true });
    } catch (err) {
      errorEl.textContent = err.message;
      errorEl.hidden = false;
      submit.disabled = false;
      submit.textContent = signup ? 'Create account' : 'Sign in';
    }
  });
}
