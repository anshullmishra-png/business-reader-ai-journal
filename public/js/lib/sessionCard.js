// One session row, used on Today and History.
import { html, scoreClass } from './dom.js';
import { SOURCE_LABELS, STAGE_LABELS, fmtDate, fmtTime, fmtScore, plural } from './format.js';

export function sessionCard(s, { showDate = false } = {}) {
  const done = s.stage === 'verdict' && s.overall_score != null;
  return html`
    <a class="card session-card" href="/session/${s.id}" data-link>
      <div class="session-card-main">
        <div class="session-card-title">${s.title}</div>
        <div class="meta-row" style="margin-top:6px">
          <span>${SOURCE_LABELS[s.source]}</span>
          ${s.tags?.sector ? html`<span>${s.tags.sector}</span>` : ''}
          <span>${plural(s.word_count, 'word')}</span>
          <span>${showDate ? `${fmtDate(s.created_at)}, ` : ''}${fmtTime(s.created_at)}</span>
        </div>
      </div>
      ${done
        ? html`<div class="session-card-score ${scoreClass(s.overall_score)}">${fmtScore(s.overall_score)}</div>`
        : html`<span class="pill">${STAGE_LABELS[s.stage]}</span>`}
    </a>`;
}
