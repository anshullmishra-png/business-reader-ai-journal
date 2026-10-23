import { html, raw, toast } from '../lib/dom.js';
import { icon } from '../lib/icons.js';
import { setHeader } from '../shell.js';
import { appState } from '../app.js';

// Must match DEFAULT_SERVER in extension/config.js.
const DEFAULT_SERVER = 'https://business-reads-journal.vercel.app';

export default async function render(el) {
  setHeader({ title: 'Install the extension' });
  const token = appState.user.capture_token;
  const origin = location.origin;
  const custom = origin !== DEFAULT_SERVER;

  el.innerHTML = html`
    <header class="page-head">
      <div class="label">Browser extension</div>
      <h1 class="page-title">Install "Send to Journal"</h1>
      <p class="page-lede">It copies the article you're reading, exactly as you see it while logged in, into your journal.
        It never logs in anywhere or reads your passwords, and it only acts when you click it. Works in Chrome and Edge on a computer.</p>
    </header>

    <div class="bento">
      <ol class="card steps">
        <li>
          <div class="step-title">Download and unzip</div>
          <p class="hint">Unzip it somewhere you'll keep it, like Documents. Chrome loads it from that folder.</p>
          <div><a class="btn btn-primary" href="/downloads/send-to-journal.zip" download>${raw(icon('download'))}Download extension (.zip)</a></div>
        </li>
        <li>
          <div class="step-title">Open the extensions page</div>
          <p class="hint">Type <code>chrome://extensions</code> (or <code>edge://extensions</code>) in the address bar and turn on <strong>Developer mode</strong>.</p>
        </li>
        <li>
          <div class="step-title">Click "Load unpacked"</div>
          <p class="hint">Choose the unzipped <code>send-to-journal</code> folder. Then pin it from the puzzle-piece menu next to the address bar.</p>
        </li>
        <li>
          <div class="step-title">Paste your capture token</div>
          <p class="hint">Right-click the extension's icon → <strong>Options</strong>, paste this token and click Save.</p>
          <div class="code-row"><code class="code">${token}</code>
            <button class="btn btn-secondary btn-sm" type="button" data-copy="${token}">${raw(icon('copy'))}Copy</button></div>
          ${custom ? html`<p class="hint">Also set the journal address to:</p>
            <div class="code-row"><code class="code">${origin}</code>
            <button class="btn btn-secondary btn-sm" type="button" data-copy="${origin}">${raw(icon('copy'))}Copy</button></div>` : ''}
        </li>
        <li>
          <div class="step-title">Send your first article</div>
          <p class="hint">Open an article (log in first for paid stories), click the icon, then <strong>Send to Journal</strong>.</p>
        </li>
      </ol>

      <aside class="card card-soft">
        <h2 class="card-title">${raw(icon('info'))}No extension?</h2>
        <p class="hint">On a phone, or for free articles, paste the link on the Today page instead and the journal fetches the text itself.
          Paywalled stories need the extension, because only your browser can see them.</p>
        <div><a class="btn btn-secondary" href="/" data-link>${raw(icon('arrow-right'))}Go to Today</a></div>
      </aside>
    </div>`.toString();

  el.addEventListener('click', async (e) => {
    const c = e.target.closest('[data-copy]');
    if (c) {
      await navigator.clipboard.writeText(c.dataset.copy);
      toast('Copied');
    }
  });
}
