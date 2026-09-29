import { html, raw, scoreClass } from '../lib/dom.js';
import { api } from '../lib/api.js';
import { icon } from '../lib/icons.js';
import { setHeader } from '../shell.js';
import { fmtDate, fmtScore } from '../lib/format.js';

function points(list) {
  return html`<ul class="review-points">${list.map((p) => html`<li><strong>${p.point}</strong><span>${p.evidence}</span></li>`)}</ul>`;
}

function reviewCard(r) {
  const c = r.content;
  const s = c.stats ?? {};
  return html`
    <article class="card review">
      <div class="review-head">
        <div class="meta-row" style="margin:0"><span>${fmtDate(r.period_start)} – ${fmtDate(r.period_end)}</span>
          <span>${r.session_ids.length} session${r.session_ids.length === 1 ? '' : 's'}</span></div>
        <span class="score score-sm ${scoreClass(s.overall)}">${fmtScore(s.overall)}</span>
      </div>
      <h2 class="review-headline">${c.headline}</h2>

      <div class="review-grid">
        <div><div class="entry-label">What improved</div>${points(c.improved)}</div>
        <div><div class="entry-label">Still weak</div>${points(c.still_weak)}</div>
      </div>

      <div class="entry-label">Patterns</div>
      <ul class="review-list">${c.patterns.map((p) => html`<li>${p}</li>`)}</ul>

      <div class="entry-label">Goals for next week</div>
      <ol class="review-list">${c.goals.map((g) => html`<li>${g}</li>`)}</ol>

      <p class="qr-feedback" style="margin-top:20px">${c.verdict}</p>
    </article>`;
}

export default async function render(el) {
  setHeader({ title: 'Weekly reviews' });
  let timer = null;

  async function draw() {
    const { reviews, pending, last_failed } = await api('/reviews');
    el.innerHTML = html`
      <h1 class="page-title">Weekly reviews</h1>
      <p class="page-lede">Written after every 7 scored sessions or 7 days, whichever comes first, the next time you open the app.</p>
      <section class="section">
        ${pending ? html`<div class="card" style="margin-bottom:12px">
          <p class="status-line">${raw(icon('loader-circle', 'spin'))}Writing this week's review…</p>
          <div class="skeleton skeleton-line w-80"></div><div class="skeleton skeleton-line w-60"></div></div>` : ''}
        ${!pending && last_failed ? html`<p class="hint" style="margin-bottom:12px">The last review couldn't be written. It will be retried next time you open the app.</p>` : ''}
        ${reviews.length ? reviews.map(reviewCard) : !pending ? html`<div class="empty">${raw(icon('file-text'))}
          <div class="empty-title">No reviews yet</div>Your first review is written after 7 scored sessions or 7 days.</div>` : ''}
      </section>`.toString();
    clearTimeout(timer);
    if (pending) timer = setTimeout(draw, 5000);
  }

  await draw();
  return () => clearTimeout(timer);
}
