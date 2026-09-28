import { html, raw, $, toast } from '../lib/dom.js';
import { api } from '../lib/api.js';
import { icon } from '../lib/icons.js';
import { setHeader } from '../shell.js';
import { appState } from '../app.js';

const shot = (label) => html`<div class="shot-placeholder" role="img" aria-label="Screenshot placeholder: ${label}">
  ${raw(icon('layers'))}<span>Screenshot: ${label}</span></div>`;

export default async function render(el) {
  setHeader({ title: 'Install the extension' });
  const settings = await api('/settings');
  const dir = appState.health?.extension_dir ?? 'the extension folder inside this project';
  const port = appState.health?.port ?? 4317;

  el.innerHTML = html`
    <h1 class="page-title">Install the extension</h1>
    <p class="page-lede">"Send to Journal" copies the article you're reading, exactly as you see it while logged in, into this journal.
      It never logs in anywhere or reads your passwords. It only acts when you click it.</p>

    <section class="section">
      <ol class="steps">
        <li>
          <div class="step-title">Open the extensions page</div>
          <p class="hint">In Chrome, go to <code>chrome://extensions</code>. In Edge, go to <code>edge://extensions</code>.
            (Type it in the address bar; links to these pages can't be clicked.)</p>
        </li>
        <li>
          <div class="step-title">Turn on Developer mode</div>
          <p class="hint">Chrome: the switch at the top right. Edge: the switch in the left sidebar.</p>
          ${shot('Developer mode switch')}
        </li>
        <li>
          <div class="step-title">Click "Load unpacked" and choose this folder</div>
          <div class="code-row"><code class="code">${dir}</code>
            <button class="btn btn-ghost btn-sm" type="button" data-copy="${dir}">${raw(icon('copy'))}Copy</button></div>
          ${shot('Load unpacked, selecting the extension folder')}
        </li>
        <li>
          <div class="step-title">Pin it to the toolbar</div>
          <p class="hint">Click the puzzle-piece icon next to the address bar, then the pin next to "Send to Journal".</p>
        </li>
        <li>
          <div class="step-title">Paste your capture token</div>
          <p class="hint">Right-click the extension's icon → <strong>Options</strong>, paste this token and click Save.
            ${port !== 4317 ? html`Also set the journal address to <code>http://127.0.0.1:${port}</code>.` : ''}</p>
          <div class="code-row"><code class="code">${settings.capture_token}</code>
            <button class="btn btn-ghost btn-sm" type="button" data-copy="${settings.capture_token}">${raw(icon('copy'))}Copy</button></div>
          ${shot('Extension options with the token pasted')}
        </li>
        <li>
          <div class="step-title">Send your first article</div>
          <p class="hint">Open an article (log in to The Ken first for paid stories), click the icon, then <strong>Send to Journal</strong>.
            The first capture pairs the extension with this journal.</p>
          ${shot('The popup after sending')}
        </li>
      </ol>
    </section>`.toString();

  el.addEventListener('click', async (e) => {
    const c = e.target.closest('[data-copy]');
    if (c) {
      await navigator.clipboard.writeText(c.dataset.copy);
      toast('Copied');
    }
  });
}
