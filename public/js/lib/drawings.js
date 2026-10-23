// Small line drawings for empty states. Sapphire strokes with one gold detail,
// drawn on a 120x90 grid. Decorative: hidden from screen readers.
import { raw } from './dom.js';

const svg = (body) => raw(`<svg class="drawing" viewBox="0 0 120 90" fill="none" stroke="currentColor" stroke-width="1.5"
  stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`);
const brand = 'stroke="var(--gold)"';

export const DRAWINGS = {
  // A folded morning paper and a cup.
  newspaper: svg(`
    <path d="M22 18h56v52a6 6 0 0 1-6 6H28a6 6 0 0 1-6-6z"/>
    <path d="M78 30h8v40a6 6 0 0 1-6 6h-2"/>
    <path d="M30 27h40" stroke-width="3"/>
    <path d="M30 36h18M30 42h18M30 48h18M30 54h18M30 60h14"/>
    <rect x="53" y="36" width="17" height="14" rx="1.5"/>
    <path d="M53 57h17M53 63h12"/>
    <path d="M92 58h14v10a7 7 0 0 1-7 7h0a7 7 0 0 1-7-7z" ${brand}/>
    <path d="M106 61h3a3 3 0 0 1 0 6h-3" ${brand}/>
    <path d="M96 52c0-3 2-3 2-6M101 52c0-3 2-3 2-6" ${brand} stroke-width="1.2"/>`),

  // An open book with a bookmark.
  book: svg(`
    <path d="M60 24c-9-6-22-7-36-5v48c14-2 27-1 36 5 9-6 22-7 36-5V19c-14-2-27-1-36 5z"/>
    <path d="M60 24v48"/>
    <path d="M32 31c7-1 14 0 20 3M32 39c7-1 14 0 20 3M32 47c7-1 14 0 20 3M68 34c6-3 13-4 20-3M68 42c6-3 13-4 20-3"/>
    <path d="M78 18v18l4-3 4 3V18" ${brand}/>`),

  // A chart on an easel with a rising line.
  chart: svg(`
    <rect x="22" y="14" width="76" height="52" rx="3"/>
    <path d="M34 76l12-10M86 76L74 66M60 66v12"/>
    <path d="M32 56h56" stroke-dasharray="2 4"/>
    <path d="M34 52l14-10 10 6 14-16 14 6" ${brand} stroke-width="2"/>
    <circle cx="86" cy="38" r="2.5" fill="var(--gold)" stroke="none"/>`),

  // A letter coming out of an envelope.
  letter: svg(`
    <path d="M24 40h72v34a4 4 0 0 1-4 4H28a4 4 0 0 1-4-4z"/>
    <path d="M24 40l36 22 36-22"/>
    <path d="M34 44V16h52v28"/>
    <path d="M42 24h36M42 31h36M42 38h20"/>
    <path d="M70 38h8" ${brand} stroke-width="2"/>`),

  // A notebook with a pen.
  notebook: svg(`
    <rect x="30" y="14" width="50" height="64" rx="3"/>
    <path d="M38 14v64"/>
    <path d="M46 28h26M46 36h26M46 44h18"/>
    <path d="M86 66l14-40 5 2-14 40-6 3z" ${brand}/>
    <path d="M97 34l5 2" ${brand}/>`),

  // A magnifying glass over lines.
  search: svg(`
    <path d="M22 26h40M22 36h30M22 46h36M22 56h24"/>
    <circle cx="74" cy="46" r="16"/>
    <path d="M86 58l14 14" stroke-width="3"/>
    <path d="M67 40a9 9 0 0 1 9-3" ${brand}/>`),
};

export const drawing = (name) => DRAWINGS[name] ?? DRAWINGS.notebook;
