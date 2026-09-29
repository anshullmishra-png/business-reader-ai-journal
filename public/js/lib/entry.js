// Renders one glossary entry. Used by the dictionary panel and the glossary page.
import { html, raw } from './dom.js';
import { icon } from './icons.js';
import { fmtDate } from './format.js';

export function entryHtml(t, { compact = false } = {}) {
  return html`
    <article class="entry" data-term-id="${t.id}">
      ${compact ? '' : html`<h3 class="entry-term">${t.term}</h3>`}
      <p class="entry-def">${t.definition}</p>
      ${t.formula ? html`<div class="entry-formula">${t.formula}</div>` : ''}

      <div class="entry-label">Examples</div>
      <ul class="entry-examples">
        ${t.examples.map((e) => html`<li><strong>${e.company}.</strong> ${e.example}</li>`)}
      </ul>
      <button class="btn btn-ghost btn-sm" type="button" data-more-examples="${t.id}">${raw(icon('plus'))}More examples</button>

      <div class="entry-label">Why a Chief of Staff should care</div>
      <p class="entry-why">${t.why_it_matters}</p>

      <div class="entry-label">Related</div>
      <div class="entry-related">
        ${t.related.map((r) => html`<button class="pill tag-pill related-term" type="button" data-lookup="${r}">${r}</button>`)}
      </div>

      <p class="entry-meta">
        ${t.sector ? html`<span class="tag">${t.sector}</span>` : ''}
        <span>Looked up ${t.lookup_count}×</span>
        <span>First ${fmtDate(t.created_at)}${t.first_session_title ? html` · while reading <a href="/session/${t.first_session_id}" data-link>${t.first_session_title}</a>` : ''}</span>
      </p>
    </article>`;
}

export function entrySkeleton(term) {
  return html`
    <p class="status-line">${raw(icon('loader-circle', 'spin'))}Looking up “${term}”…</p>
    <div class="skeleton skeleton-line" style="width:55%;height:22px;margin-top:14px"></div>
    <div class="skeleton skeleton-line w-80"></div>
    <div class="skeleton skeleton-line"></div>
    <div class="skeleton skeleton-line w-60"></div>
    <div class="skeleton skeleton-line w-80" style="margin-top:22px"></div>
    <div class="skeleton skeleton-line w-60"></div>`;
}
