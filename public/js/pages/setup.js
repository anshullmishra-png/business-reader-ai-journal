// Shown in place of AI-driven pages until Claude Code is installed and logged in.
import { html, raw, $, toast } from '../lib/dom.js';
import { api } from '../lib/api.js';
import { icon } from '../lib/icons.js';
import { setHeader } from '../shell.js';
import { appState } from '../app.js';

function codeBlock(text) {
  return html`<div class="code-row">
    <code class="code">${text}</code>
    <button class="btn btn-ghost btn-sm" type="button" data-copy="${text}">${raw(icon('copy'))}Copy</button>
  </div>`;
}

function body(ai) {
  const exe = ai.exe_path ?? '%USERPROFILE%\\.local\\bin\\claude.exe';
  const psExe = `& "${exe.replace(/^%USERPROFILE%/, '$env:USERPROFILE')}"`;

  if (ai.status === 'checking') {
    return html`
      <div class="card">
        <p class="status-line">${raw(icon('loader-circle', 'spin'))}Checking Claude Code on this laptop…</p>
        <div class="skeleton skeleton-line w-80"></div>
        <div class="skeleton skeleton-line w-60"></div>
      </div>`;
  }

  if (ai.status === 'not_installed') {
    return html`
      <ol class="steps">
        <li>
          <div class="step-title">Install Claude Code</div>
          <p class="hint">Open <strong>PowerShell</strong> (Start menu → type "PowerShell") and run:</p>
          ${codeBlock('irm https://claude.ai/install.ps1 | iex')}
        </li>
        <li>
          <div class="step-title">Log in with your Claude account</div>
          <p class="hint">In the same window, run the command below. A browser window opens; sign in with the account that has your Claude subscription.</p>
          ${codeBlock('& "$env:USERPROFILE\\.local\\bin\\claude.exe" auth login')}
        </li>
        <li>
          <div class="step-title">Come back and check again</div>
        </li>
      </ol>`;
  }

  if (ai.status === 'not_logged_in') {
    return html`
      <ol class="steps">
        <li>
          <div class="step-title">Log in to Claude Code</div>
          <p class="hint">Open <strong>PowerShell</strong> and run the command below. A browser window opens; sign in with the account that has your Claude subscription.</p>
          ${codeBlock(`${psExe} auth login`)}
          <p class="hint">Logging in to the Claude desktop app isn't enough: the command-line tool keeps its own login.</p>
        </li>
        <li>
          <div class="step-title">Come back and check again</div>
        </li>
      </ol>`;
  }

  return html`
    <div class="card">
      <div class="step-title">The test call to Claude Code failed</div>
      <p class="hint" style="margin-top:6px">${ai.message ?? 'Unknown error.'}</p>
      <p class="hint" style="margin-top:10px">Check your internet connection. If it keeps failing, run this in PowerShell to see what Claude Code reports:</p>
      ${codeBlock(`${psExe} auth status`)}
    </div>`;
}

export default async function render(el, _params, { onReady } = {}) {
  setHeader({ title: 'Set up the AI engine' });

  const draw = () => {
    const ai = appState.ai ?? { status: 'checking' };
    el.innerHTML = html`
      <h1 class="page-title">Connect Claude Code</h1>
      <p class="page-lede">The journal uses Claude Code on this laptop as its AI engine, with your own Claude subscription.
        No API key, nothing to pay for separately.</p>
      <section class="section">${body(ai)}</section>
      ${ai.status !== 'checking' ? html`
        <section class="section row">
          <button class="btn btn-primary" id="recheck" type="button" ${ai.checking ? raw('disabled') : ''}>
            ${raw(icon('refresh-cw'))}${ai.checking ? 'Checking…' : 'Check again'}
          </button>
          <a class="link-quiet" href="/settings" data-link>AI details in Settings</a>
        </section>` : ''}`.toString();
  };

  let timer = null;
  let stopped = false;

  const poll = async () => {
    if (stopped) return;
    appState.ai = await api('/ai/health').catch(() => appState.ai);
    if (appState.ai?.status === 'ready' && !appState.ai.checking) {
      onReady?.();
      return;
    }
    draw();
    if (appState.ai?.checking || appState.ai?.status === 'checking') timer = setTimeout(poll, 1500);
  };

  el.addEventListener('click', async (e) => {
    const copy = e.target.closest('[data-copy]');
    if (copy) {
      await navigator.clipboard.writeText(copy.dataset.copy);
      toast('Copied');
      return;
    }
    if (e.target.closest('#recheck')) {
      appState.ai = await api('/ai/health/recheck', { method: 'POST' });
      draw();
      clearTimeout(timer);
      timer = setTimeout(poll, 1000);
    }
  });

  draw();
  if (appState.ai?.checking || appState.ai?.status === 'checking') timer = setTimeout(poll, 1500);

  return () => { stopped = true; clearTimeout(timer); };
}
