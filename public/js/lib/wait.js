// Every AI wait shows what's happening, a running clock and a rough expectation,
// instead of a bare spinner. Pages re-render while polling, so each wait is keyed:
// the clock keeps counting from when that wait first appeared.
import { html, raw } from './dom.js';
import { icon } from './icons.js';

const started = new Map();

const fmt = (ms) => {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};

/**
 * @param {string} key   stable id for this wait (e.g. `questions:12`)
 * @param {string} label what the AI is doing, in plain words
 * @param {string} [expect] e.g. 'Usually 20–40 seconds'
 */
export function aiWait(key, label, expect = '') {
  if (!started.has(key)) started.set(key, Date.now());
  return html`<div class="ai-wait" data-wait-key="${key}" role="status">
    <div class="ai-wait-line">${raw(icon('loader-circle', 'spin'))}<span class="ai-wait-label">${label}</span>
      <span class="ai-wait-clock" data-wait-since="${started.get(key)}">${fmt(Date.now() - started.get(key))}</span></div>
    <div class="ai-wait-bar" aria-hidden="true"><span></span></div>
    ${expect ? html`<div class="ai-wait-expect">${expect}</div>` : ''}
  </div>`;
}

/** Forget a wait once it's done, so a later wait with the same key starts at 0:00. */
export const endWait = (key) => started.delete(key);

// One ticker for every clock on the page.
setInterval(() => {
  for (const el of document.querySelectorAll('[data-wait-since]')) {
    el.textContent = fmt(Date.now() - Number(el.dataset.waitSince));
  }
}, 1000);
