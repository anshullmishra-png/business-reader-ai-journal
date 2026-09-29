// Small typographic marks for each source. Generic letter marks (not the
// publications' logos); shape differs as well as colour, and the name is
// always shown next to the mark.
import { html } from './dom.js';
import { SOURCE_LABELS } from './format.js';

const GLYPHS = { the_ken: 'K', the_arc: 'A', entrackr: 'E', other: '·' };

export function sourceMark(source, { withName = true } = {}) {
  const key = GLYPHS[source] ? source : 'other';
  return html`<span class="src src-${key}" title="${SOURCE_LABELS[key]}">
    <span class="src-glyph" aria-hidden="true">${GLYPHS[key]}</span>${withName ? html`<span class="src-name">${SOURCE_LABELS[key]}</span>` : ''}
  </span>`;
}
