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
        <p style="margin-bottom:18px"><a class="link-quiet" href="/extension" data-link>${raw(icon('puzzle'))}How to install the extension</a></p>
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
      <div class="card" id="backup-card">
        <div class="field">
          <span class="label">Export a backup</span>
          <span class="hint">Downloads a complete copy of your journal as one .db file. A copy is also kept in <code>data/backups</code>.</span>
          <div><a class="btn btn-ghost btn-sm" href="/api/backup/export" download>${raw(icon('download'))}Export backup</a></div>
        </div>
        <div class="field">
          <label class="label" for="restore-file">Restore a backup</label>
          <span class="hint">Replaces everything in this journal with the backup. Your current journal is saved to <code>data/backups</code> first.</span>
          <div class="row">
            <input type="file" id="restore-file" accept=".db" class="visually-hidden">
            <button class="btn btn-ghost btn-sm" type="button" id="restore-btn">${raw(icon('upload'))}Choose a backup file…</button>
          </div>
          <p class="hint" id="restore-status" aria-live="polite"></p>
        </div>
        <p class="hint" id="backup-list"></p>
      </div>
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

  // ---- Backup / restore ----
  api('/backup').then(({ backups }) => {
    $('#backup-list', el).textContent = backups.length
      ? `${backups.length} backup${backups.length === 1 ? '' : 's'} saved. Latest: ${backups[0].name}`
      : 'No backups yet.';
  }).catch(() => {});

  $('#restore-btn', el).addEventListener('click', () => $('#restore-file', el).click());
  $('#restore-file', el).addEventListener('change', async (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    if (!confirm(`Restore "${file.name}"? Everything currently in this journal will be replaced (a safety copy is saved first).`)) return;
    const status = $('#restore-status', el);
    status.textContent = 'Checking and uploading the backup…';
    try {
      const res = await fetch('/api/backup/restore', {
        method: 'POST', headers: { 'Content-Type': 'application/octet-stream' }, body: file,
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? 'Restore failed.');
      if (data.restart === 'manual') {
        status.textContent = `Backup accepted (${data.sessions} sessions, ${data.terms} terms). Restart the app to finish: close its window and run start.bat again.`;
        return;
      }
      status.textContent = `Backup accepted (${data.sessions} sessions, ${data.terms} terms). Restarting…`;
      // Wait for the server to come back, then reload.
      await new Promise((r) => setTimeout(r, 1500));
      for (let i = 0; i < 40; i++) {
        try { if ((await fetch('/api/health')).ok) { location.href = '/'; return; } } catch { /* still restarting */ }
        await new Promise((r) => setTimeout(r, 500));
      }
      status.textContent = 'The app is taking a while to restart. Check its window, or run start.bat again.';
    } catch (err) {
      status.textContent = err.message;
    }
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
