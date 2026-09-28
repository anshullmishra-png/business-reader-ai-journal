import { html, raw } from '../lib/dom.js';
import { icon } from '../lib/icons.js';
import { setHeader } from '../shell.js';

export default async function render(el) {
  setHeader({ title: 'Today' });
  const date = new Date().toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long' });

  el.innerHTML = html`
    <h1 class="page-title">Today</h1>
    <div class="meta-row"><span>${date}</span></div>

    <section class="section">
      <div class="bento">
        <div class="bento-tabs">
          <span class="pill pill-dark">Paste link</span>
          <span class="pill">Paste text</span>
        </div>
        <form class="bento-body row" id="add-form">
          <label class="visually-hidden" for="add-url">Article link</label>
          <input class="input" id="add-url" type="url" style="flex:1;border:none;padding-left:0"
                 placeholder="Paste an article link (The Arc, Entrackr, …)" disabled>
          <button class="btn btn-primary" type="submit" disabled>Start session ${raw(icon('arrow-right'))}</button>
        </form>
      </div>
      <p class="hint" style="margin-top:14px">
        Reading on The Ken? Use the <strong>Send to Journal</strong> browser extension so the text comes straight from your logged-in tab.
        (Article capture is built in phase 3.)
      </p>
    </section>

    <section class="section">
      <h2 class="section-heading">Today's sessions</h2>
      <div class="empty">
        ${raw(icon('notebook-pen'))}
        <div class="empty-title">Nothing read yet today</div>
        Capture your first article to start a session.
      </div>
    </section>`.toString();
}
