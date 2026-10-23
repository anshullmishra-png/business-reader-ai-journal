// Sign in / create an account. New accounts need the invite code shared with testers.
import { html, raw, $ } from '../lib/dom.js';
import { api } from '../lib/api.js';
import { icon } from '../lib/icons.js';
import { setHeader } from '../shell.js';
import { loadMe } from '../app.js';
import { navigate } from '../router.js';

const POINTS = [
  ['notebook-pen', 'Condense what you read', 'A 100–200 word brief on every article, in your own words.'],
  ['target', 'Face a tough interviewer', 'Ten timed questions on the economics, strategy and judgement behind it.'],
  ['chart-line', 'Watch the scores move', 'Difficulty adapts to you. Weekly reviews show what to work on.'],
];

export default async function render(el) {
  const signup = location.pathname === '/signup';
  setHeader({ title: signup ? 'Create your account' : 'Sign in' });
  const next = new URLSearchParams(location.search).get('next');
  const safeNext = next?.startsWith('/') && !next.startsWith('//') ? next : '/';
  const qs = next ? `?next=${encodeURIComponent(next)}` : '';

  el.innerHTML = html`
    <div class="auth">
      <section class="auth-intro">
        <div class="brand brand-lg"><span class="brand-mark">${raw(icon('notebook-pen'))}</span><span class="brand-name">Business Reads</span></div>
        <h1 class="auth-headline">Turn your daily business reading into Chief of Staff interview practice.</h1>
        <ul class="auth-points">
          ${POINTS.map(([ic, t, d]) => html`<li><span class="auth-point-icon">${raw(icon(ic))}</span>
            <div><div class="auth-point-title">${t}</div><div class="hint">${d}</div></div></li>`)}
        </ul>
      </section>

      <form class="card auth-card" id="auth-form" novalidate>
        <div class="label">${signup ? 'New account' : 'Welcome back'}</div>
        <h2 class="auth-title">${signup ? 'Create your journal' : 'Sign in to your journal'}</h2>
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
    </div>`.toString();

  const form = $('#auth-form', el);
  const errorEl = $('#auth-error', el);
  const submit = $('#auth-submit', el);
  form.querySelector('input').focus();

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
