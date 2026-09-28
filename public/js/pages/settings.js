import { html, raw, $, toast } from '../lib/dom.js';
import { api } from '../lib/api.js';
import { icon } from '../lib/icons.js';
import { setHeader, setProfile } from '../shell.js';
import { appState } from '../app.js';

export default async function render(el) {
  setHeader({ title: 'Settings' });
  const s = await api('/settings');

  el.innerHTML = html`
    <h1 class="page-title">Settings</h1>
    <p class="page-lede">Everything is stored on this laptop, in <code>data/journal.db</code>.</p>

    <section class="section">
      <h2 class="section-heading">You</h2>
      <form class="card" id="prefs">
        <div class="field">
          <label class="label" for="name">Your name</label>
          <input class="input" id="name" name="name" maxlength="60" value="${s.name}" placeholder="Shown in the sidebar">
        </div>
        <div class="field">
          <label class="label" for="timer">Seconds per interview question</label>
          <input class="input" id="timer" name="timer_seconds" type="number" min="20" max="300" step="5"
                 value="${s.timer_seconds}" style="width:120px">
          <span class="hint">Default 60. Between 20 and 300.</span>
        </div>
        <div class="field">
          <label class="switch">
            <input type="checkbox" name="template_default" ${s.template_default ? raw('checked') : ''}>
            Start the comprehension editor with the template on
          </label>
        </div>
        <div class="field">
          <div><button class="btn btn-primary" type="submit">Save</button></div>
        </div>
      </form>
    </section>

    <section class="section">
      <h2 class="section-heading">Browser extension</h2>
      <div class="card">
        <div class="field">
          <label class="label" for="token">Capture token</label>
          <div class="row">
            <input class="input input-mono" id="token" readonly value="${s.capture_token}" style="flex:1">
            <button class="btn btn-ghost" type="button" id="copy-token">${raw(icon('copy'))}Copy</button>
          </div>
          <span class="hint">Paste this once into the extension's options page. The app rejects captures without it.</span>
        </div>
        <div class="field">
          <span class="label">Paired extension</span>
          <span class="hint">${s.extension_origin ?? 'None yet. The first capture with a valid token pairs the extension.'}</span>
        </div>
        <div class="field">
          <div><button class="btn btn-ghost btn-sm" type="button" id="regen-token">${raw(icon('refresh-cw'))}Generate a new token</button></div>
          <span class="hint">You'll need to paste the new token into the extension again.</span>
        </div>
      </div>
    </section>

    <section class="section">
      <h2 class="section-heading">AI engine</h2>
      <div class="card" id="ai-card"></div>
    </section>

    <section class="section">
      <h2 class="section-heading">Backup</h2>
      <div class="card"><span class="hint">Export and restore arrive in phase 11.</span></div>
    </section>`.toString();

  // ---- AI engine card ----
  const STATUS = {
    ready: ['ok', 'Ready'],
    checking: ['', 'Checking…'],
    not_installed: ['bad', 'Not installed'],
    not_logged_in: ['bad', 'Not logged in'],
    error: ['bad', 'Test call failed'],
  };
  let aiTimer = null;
  const drawAi = (ai) => {
    const [dot, label] = STATUS[ai.checking ? 'checking' : ai.status] ?? ['bad', ai.status];
    $('#ai-card', el).innerHTML = html`
      <dl class="dl">
        <dt>Status</dt><dd><span class="status-dot ${dot}"></span>${label}${ai.message && ai.status !== 'ready' ? html` <span class="hint">(${ai.message})</span>` : ''}</dd>
        <dt>Claude Code</dt><dd>${ai.version ?? '—'}</dd>
        <dt>Executable</dt><dd class="hint">${ai.exe_path ?? 'not found'}</dd>
        <dt>Login</dt><dd>${ai.auth_method ?? '—'}</dd>
        <dt>AI calls today</dt><dd>${ai.calls_today.total}${ai.calls_today.total ? html` <span class="hint">(${ai.calls_today.ok} succeeded)</span>` : ''}</dd>
      </dl>
      <div class="row" style="margin-top:18px">
        <button class="btn btn-ghost btn-sm" type="button" id="ai-recheck" ${ai.checking ? raw('disabled') : ''}>${raw(icon('refresh-cw'))}Check again</button>
        <span class="hint">API keys are never passed to Claude Code; it always uses your subscription login.</span>
      </div>`.toString();
    appState.ai = ai;
    clearTimeout(aiTimer);
    if (ai.checking) aiTimer = setTimeout(async () => drawAi(await api('/ai/health')), 1500);
  };
  drawAi(await api('/ai/health'));
  el.addEventListener('click', async (e) => {
    if (e.target.closest('#ai-recheck')) drawAi(await api('/ai/health/recheck', { method: 'POST' }));
  });

  $('#prefs', el).addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = new FormData(e.target);
    try {
      const saved = await api('/settings', {
        method: 'PATCH',
        body: {
          name: String(f.get('name') ?? ''),
          timer_seconds: Number(f.get('timer_seconds')),
          template_default: f.get('template_default') === 'on',
        },
      });
      appState.settings = saved;
      setProfile({ name: saved.name, demo: appState.health?.demo });
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
    const { capture_token } = await api('/settings/capture-token/regenerate', { method: 'POST' });
    $('#token', el).value = capture_token;
    toast('New token generated');
  });

  return () => clearTimeout(aiTimer);
}
