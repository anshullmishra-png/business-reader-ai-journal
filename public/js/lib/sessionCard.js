// One session row, used on Today and History.
import { html, scoreClass } from './dom.js';
import { STAGE_LABELS, fmtDate, fmtTime, fmtScore, plural } from './format.js';
import { sourceMark } from './sourceMark.js';

export function sessionCard(s, { showDate = false } = {}) {
  const done = s.stage === 'verdict' && s.overall_score != null;
  return html`
    <a class="list-row session-row" href="/session/${s.id}" data-link>
      <div class="list-row-main">
        <div class="list-row-title">${s.title}</div>
        <div class="meta-row">
          ${sourceMark(s.source)}
          ${s.tags?.sector ? html`<span>${s.tags.sector}</span>` : ''}
          <span>${plural(s.word_count, 'word')}</span>
          <span>${showDate ? `${fmtDate(s.created_at)}, ` : ''}${fmtTime(s.created_at)}</span>
        </div>
      </div>
      ${done
        ? html`<span class="score-badge ${scoreClass(s.overall_score)}">${fmtScore(s.overall_score)}<small>/10</small></span>`
        : html`<span class="pill pill-active">${STAGE_LABELS[s.stage]}</span>`}
    </a>`;
}
