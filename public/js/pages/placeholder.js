// Shared layout for pages that are still empty in this build phase.
import { html, raw } from '../lib/dom.js';
import { icon } from '../lib/icons.js';
import { setHeader } from '../shell.js';

export function placeholderPage({ title, lede, iconName, emptyTitle, emptyText }) {
  return async function render(el) {
    setHeader({ title });
    el.innerHTML = html`
      <h1 class="page-title">${title}</h1>
      <p class="page-lede">${lede}</p>
      <section class="section">
        <div class="empty">
          ${raw(icon(iconName))}
          <div class="empty-title">${emptyTitle}</div>
          ${emptyText}
        </div>
      </section>`.toString();
  };
}
