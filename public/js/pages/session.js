import { html, raw } from '../lib/dom.js';
import { icon } from '../lib/icons.js';
import { setHeader } from '../shell.js';

// Placeholder until the staged flow lands (phases 3–7).
export default async function render(el, { id }) {
  setHeader({ title: `Session ${id}`, pill: 'Add', stage: 'add' });
  el.innerHTML = html`
    <div class="empty">
      ${raw(icon('layers'))}
      <div class="empty-title">Session ${id} not found</div>
      Sessions are created once article capture is built.
      <div style="margin-top:16px"><a class="btn btn-ghost btn-sm" href="/" data-link>Back to Today</a></div>
    </div>`.toString();
}
