import { html, raw, $, toast } from '../lib/dom.js';
import { api } from '../lib/api.js';
import { icon } from '../lib/icons.js';
import { setHeader } from '../shell.js';
import { navigate } from '../router.js';
import { SOURCE_LABELS, fmtDate, fmtTime, fmtMaybeDate, plural } from '../lib/format.js';
import { renderWrite, renderLockedComprehension } from '../stages/write.js';
import { renderExplore } from '../stages/explore.js';

let meta = null; // { sectors, company_stages }
const getMeta = async () => (meta ??= await api('/meta'));

const STAGE_PILL = { write: 'Write', explore: 'Explore', interview: 'Interview', verdict: 'Verdict' };

// ---------- Tags ----------
const LIST_FIELDS = { companies: { label: 'Companies', max: 8 }, themes: { label: 'Themes', max: 5 } };
const TEXT_FIELDS = { business_model: { label: 'Business model', max: 60 }, geography: { label: 'Geography', max: 40 } };
const SELECT_FIELDS = { sector: { label: 'Sector', options: 'sectors' }, company_stage: { label: 'Stage', options: 'company_stages' } };

function tagsView(s, m) {
  if (s.tags_status === 'pending') {
    return html`
      <p class="status-line">${raw(icon('loader-circle', 'spin'))}Tagging companies, sector and themes…</p>
      <div class="tag-skeleton">
        <div class="skeleton" style="width:90px;height:24px"></div>
        <div class="skeleton" style="width:130px;height:24px"></div>
        <div class="skeleton" style="width:70px;height:24px"></div>
        <div class="skeleton" style="width:110px;height:24px"></div>
      </div>`;
  }
  if (s.tags_status === 'failed' || !s.tags) {
    return html`
      <div class="row">
        <p class="form-error" style="margin:0">Tagging didn't work this time.</p>
        <button class="btn btn-ghost btn-sm" type="button" data-action="retry-tags">${raw(icon('refresh-cw'))}Retry</button>
      </div>`;
  }
  const t = s.tags;
  const row = (label, content) => html`<div class="tag-row"><span class="tag-label">${label}</span><div class="tag-values">${content}</div></div>`;

  return html`<div class="tag-grid">
    ${Object.entries(SELECT_FIELDS).map(([k, f]) => row(f.label, html`
      <select class="tag-select" data-field="${k}" aria-label="${f.label}">
        ${m[f.options].map((o) => html`<option ${o === t[k] ? raw('selected') : ''}>${o}</option>`)}
      </select>`))}
    ${Object.entries(TEXT_FIELDS).map(([k, f]) => row(f.label, html`
      <input class="tag-input" data-field="${k}" value="${t[k] ?? ''}" maxlength="${f.max}" aria-label="${f.label}" placeholder="Add…">`))}
    ${Object.entries(LIST_FIELDS).map(([k, f]) => row(f.label, html`
      ${(t[k] ?? []).map((v, i) => html`<span class="pill tag-pill">${v}<button type="button" class="pill-x" data-remove="${k}" data-index="${i}" aria-label="Remove ${v}">${raw(icon('x'))}</button></span>`)}
      ${(t[k] ?? []).length < f.max ? html`<input class="tag-add" data-add="${k}" maxlength="${k === 'companies' ? 60 : 40}" placeholder="+ Add" aria-label="Add to ${f.label}">` : ''}`))}
  </div>`;
}

// ---------- Page ----------
export default async function render(el, { id }) {
  let s;
  try {
    s = await api(`/sessions/${id}`);
  } catch (err) {
    setHeader({ title: 'Session not found' });
    el.innerHTML = html`<div class="empty">${raw(icon('layers'))}
      <div class="empty-title">Session not found</div>It may have been deleted.
      <div style="margin-top:16px"><a class="btn btn-ghost btn-sm" href="/" data-link>Back to Today</a></div></div>`.toString();
    return;
  }
  const m = await getMeta();

  setHeader({ title: s.title, pill: STAGE_PILL[s.stage], stage: s.stage });

  const published = fmtMaybeDate(s.published_at);
  el.innerHTML = html`
    <h1 class="page-title article-title">${s.title}</h1>
    <div class="meta-row">
      <span>${SOURCE_LABELS[s.source]}</span>
      <span>${plural(s.word_count, 'word')}</span>
      <span>Captured ${fmtDate(s.created_at)}, ${fmtTime(s.created_at)}</span>
      ${published ? html`<span>Published ${published}</span>` : ''}
      ${s.author ? html`<span>${s.author}</span>` : ''}
    </div>
    ${s.url ? html`<p style="margin-top:14px"><a class="link-quiet" href="${s.url}" target="_blank" rel="noopener noreferrer">${raw(icon('external-link'))}Read on the original site</a></p>` : ''}

    <section class="section">
      <h2 class="section-heading">Tags</h2>
      <div class="card" id="tags"></div>
    </section>

    <section class="section" id="stage"></section>

    <section class="section">
      <button class="btn btn-ghost btn-sm" type="button" data-action="delete">${raw(icon('trash-2'))}Delete this session</button>
    </section>`.toString();

  const tagsEl = $('#tags', el);
  const drawTags = () => { tagsEl.innerHTML = tagsView(s, m).toString(); };
  drawTags();

  // ---- Stage content ----
  let stageCleanup = null;
  const drawStage = () => {
    stageCleanup?.();
    stageCleanup = null;
    setHeader({ title: s.title, pill: STAGE_PILL[s.stage], stage: s.stage });
    const stageEl = $('#stage', el);
    stageEl.innerHTML = '';

    if (s.stage === 'write') {
      stageCleanup = renderWrite(stageEl, s, {
        onSubmitted: (updated) => { s = updated; drawStage(); $('#main').scrollTop = 0; },
      });
      return;
    }
    const locked = document.createElement('div');
    const next = document.createElement('div');
    next.className = 'section';
    stageEl.append(locked, next);
    renderLockedComprehension(locked, s);
    if (s.stage === 'explore') {
      stageCleanup = renderExplore(next, s, { onChange: (fresh) => { s = fresh; } });
    }
  };
  drawStage();

  // Poll while tagging runs.
  let timer = null;
  const poll = async () => {
    const fresh = await api(`/sessions/${id}`).catch(() => null);
    if (!fresh) return;
    s = fresh;
    if (s.tags_status === 'pending') timer = setTimeout(poll, 2000);
    else drawTags();
  };
  if (s.tags_status === 'pending') timer = setTimeout(poll, 2000);

  async function saveTags(tags) {
    try {
      s = await api(`/sessions/${id}/tags`, { method: 'PUT', body: tags });
    } catch (err) {
      toast(err.status === 400 ? 'That tag is too long.' : err.message);
    }
    drawTags();
  }

  // ---- Tag editing ----
  tagsEl.addEventListener('change', (e) => {
    const f = e.target.dataset.field;
    if (f) saveTags({ ...s.tags, [f]: e.target.value.trim() });
  });
  tagsEl.addEventListener('keydown', (e) => {
    const k = e.target.dataset.add;
    if (k && e.key === 'Enter') {
      e.preventDefault();
      const v = e.target.value.trim();
      if (v && !s.tags[k].some((x) => x.toLowerCase() === v.toLowerCase())) {
        saveTags({ ...s.tags, [k]: [...s.tags[k], v] });
      }
    }
    if (e.target.dataset.field && e.key === 'Enter') e.target.blur();
  });
  tagsEl.addEventListener('click', async (e) => {
    const x = e.target.closest('[data-remove]');
    if (x) {
      const k = x.dataset.remove;
      saveTags({ ...s.tags, [k]: s.tags[k].filter((_, i) => i !== Number(x.dataset.index)) });
    }
    if (e.target.closest('[data-action="retry-tags"]')) {
      s = await api(`/sessions/${id}/tags/retry`, { method: 'POST' });
      drawTags();
      timer = setTimeout(poll, 2000);
    }
  });

  el.querySelector('[data-action="delete"]').addEventListener('click', async () => {
    if (!confirm('Delete this session? Your writing and scores for it will be removed. This cannot be undone.')) return;
    await api(`/sessions/${id}`, { method: 'DELETE' });
    toast('Session deleted');
    navigate('/');
  });

  return () => { clearTimeout(timer); stageCleanup?.(); };
}
