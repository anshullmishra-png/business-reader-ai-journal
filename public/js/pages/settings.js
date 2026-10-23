import { html, raw, $, toast } from '../lib/dom.js';
import { api } from '../lib/api.js';
import { icon } from '../lib/icons.js';
import { setHeader, setProfile } from '../shell.js';
import { appState, loadMe } from '../app.js';

const usd = (n) => `$${(n ?? 0).toFixed(n >= 1 ? 2 : 3)}`;
const fmtTokens = (n) => (n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n ?? 0));

export default async function render(el) {
  setHeader({ title: 'Settings' });
  await loadMe();
  const s = appState.user;
  const ai = appState.ai;
  const budgetUsed = Math.min(100, Math.round((ai.app_spend_today_usd / Math.max(0.01, ai.app_budget_usd)) * 100));

  el.innerHTML = html`
    <header class="page-head">
      <div class="label">Account</div>
      <h1 class="page-title">Settings</h1>
      <p class="page-lede">Your Readout is private to your account.</p>
    </header>

    <div class="bento">
      <form class="card" id="prefs">
        <h2 class="card-title">${raw(icon('user'))}You</h2>
        <div class="field">
          <label class="field-label" for="name">Your name</label>
          <input class="input" id="name" name="name" maxlength="60" value="${s.name}">
        </div>
        <div class="field">
          <span class="field-label">Email</span>
          <span>${s.email}</span>
        </div>
        <div class="field">
          <label class="field-label" for="timer">Seconds per interview question</label>
          <input class="input input-narrow" id="timer" name="timer_seconds" type="number" min="20" max="300" step="5" value="${s.timer_seconds}">
          <span class="hint">Default 60. Between 20 and 300.</span>
        </div>
        <div class="field">
          <label class="switch">
            <input type="checkbox" name="template_default" ${s.template_default ? raw('checked') : ''}>
            Start the comprehension editor with the template on
          </label>
        </div>
        <div><button class="btn btn-primary" type="submit">Save changes</button></div>
      </form>

      <div class="stack">
        <section class="card">
          <h2 class="card-title">${raw(icon('gauge'))}AI usage today</h2>
          ${ai.configured
            ? html`<div class="meter-row"><span class="stat-num">${ai.articles_today}</span><span class="hint">of ${ai.articles_per_day} article${ai.articles_per_day === 1 ? '' : 's'} today</span></div>
               <dl class="dl usage-dl">
                 <dt>Your AI calls</dt><dd>${ai.calls_today}</dd>
                 <dt>Tokens in / out</dt><dd>${fmtTokens(ai.input_tokens_today)} / ${fmtTokens(ai.output_tokens_today)}</dd>
                 <dt>Your cost</dt><dd>${usd(ai.cost_today_usd)}</dd>
               </dl>
               <div class="field-label usage-budget">Readout today: ${usd(ai.app_spend_today_usd)} of ${usd(ai.app_budget_usd)}</div>
               <div class="meter"><span style="width:${budgetUsed}%"></span></div>
               <p class="hint">Real token counts from Gemini, priced at Google's paid rates. Output includes the model's thinking. Resets at midnight UTC.</p>`
            : html`<span class="pill pill-muted">Not configured</span>
               <p class="hint">The AI isn't set up on the server yet, so questions and scoring are paused.</p>`}
        </section>

        <section class="card">
          <h2 class="card-title">${raw(icon('download'))}Your data</h2>
          <p class="hint">Download everything you've written (summaries, answers, scores, glossary and reviews) as one JSON file.</p>
          <div><a class="btn btn-secondary" href="/api/me/export" download>${raw(icon('download'))}Export my data</a></div>
        </section>
      </div>

      <section class="card bento-wide">
        <h2 class="card-title">${raw(icon('puzzle'))}Browser extension</h2>
        <div class="field">
          <label class="field-label" for="token">Capture token</label>
          <div class="row">
            <input class="input input-mono" id="token" readonly value="${s.capture_token}">
            <button class="btn btn-secondary" type="button" id="copy-token">${raw(icon('copy'))}Copy</button>
          </div>
          <span class="hint">Paste this once into the extension's options page. Captures without it are rejected.</span>
        </div>
        <div class="field">
          <span class="field-label">Paired extension</span>
          <span class="hint">${s.extension_origin ?? 'None yet. The first capture with a valid token pairs the extension.'}</span>
        </div>
        <div class="row">
          <a class="btn btn-secondary" href="/extension" data-link>${raw(icon('arrow-right'))}Install guide</a>
          <button class="btn btn-ghost" type="button" id="regen-token">${raw(icon('refresh-cw'))}Generate a new token</button>
        </div>
      </section>
    </div>`.toString();

  $('#prefs', el).addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = new FormData(e.target);
    try {
      appState.user = await api('/me/settings', {
        method: 'PATCH',
        body: {
          name: String(f.get('name') ?? '').trim() || undefined,
          timer_seconds: Number(f.get('timer_seconds')),
          template_default: f.get('template_default') === 'on',
        },
      });
      setProfile(appState.user);
      toast('Saved');
    } catch (err) {
      toast(err.status === 400 ? 'Check the values: timer must be 20–300 seconds.' : err.message);
    }
  });

  $('#copy-token', el).addEventListener('click', async () => {
    await navigator.clipboard.writeText($('#token', el).value);
    toast('Token copied');
  });

  $('#regen-token', el).addEventListener('click', async () => {
    if (!confirm('Generate a new token? The extension will stop working until you paste the new one.')) return;
    const { capture_token } = await api('/me/capture-token', { method: 'POST' });
    $('#token', el).value = capture_token;
    appState.user.capture_token = capture_token;
    toast('New token generated');
  });
}
