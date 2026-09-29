// Stage 5: Verdict, plus Stage 6: optional extra rounds.
import { html, raw, $, toast, scoreClass } from '../lib/dom.js';
import { api } from '../lib/api.js';
import { icon } from '../lib/icons.js';
import { fmtScore } from '../lib/format.js';
import { renderInterview } from './interview.js';

const TYPE_LABELS = { mcq: 'Multiple choice', short: 'Short answer', structured: 'Structured', estimation: 'Estimation' };
const LEVELS = [
  { key: 'easy', label: 'Easy' },
  { key: 'medium', label: 'Medium' },
  { key: 'hard', label: 'Hard' },
  { key: 'super_hard', label: 'Super hard' },
];
const levelLabel = (k) => LEVELS.find((l) => l.key === k)?.label ?? k;
const score = (n, cls = '') => html`<span class="score ${cls} ${scoreClass(n)}">${fmtScore(n)}</span>`;

// ---------- Pieces ----------
function workOnNext(verdict) {
  return html`
    <h2 class="section-heading">Work on this next</h2>
    <div class="won-grid">
      ${verdict.work_on_next.map((w, i) => html`
        <div class="card won">
          <div class="won-num">${i + 1}</div>
          <div>
            <div class="won-title">${w.title}</div>
            <p class="won-detail">${w.detail}</p>
            <span class="tag">${w.target}</span>
          </div>
        </div>`)}
    </div>`;
}

function mcqAnswer(q) {
  const picked = q.user_answer == null ? null : Number(q.user_answer);
  return html`<div class="mcq-review">
    ${q.options.map((o, i) => {
      const state = i === q.correct_option ? 'correct' : i === picked ? 'wrong' : '';
      return html`<div class="mcq-opt" data-state="${state}">
        <span class="option-key">${i + 1}</span><span>${o}</span>
        ${i === picked ? html`<span class="mcq-you">Your pick</span>` : ''}
      </div>`;
    })}
    ${picked == null ? html`<p class="hint" style="margin-top:8px">No option chosen.</p>` : ''}
    <p class="model-why"><strong>Why:</strong> ${q.model_answer}</p>
  </div>`;
}

function questionReview(q) {
  return html`
    <article class="card qr">
      <header class="qr-head">
        <div class="qr-tags">
          <span class="q-count">Q${q.position}</span>
          <span class="pill">${TYPE_LABELS[q.type]}</span>
          <span class="pill">${q.framework}</span>
          ${q.timed_out ? html`<span class="pill pill-warn">${raw(icon('clock'))}Timed out</span>` : ''}
        </div>
        ${score(q.score, 'score-sm')}
      </header>
      <p class="qr-prompt">${q.prompt}</p>
      ${q.type === 'mcq'
        ? mcqAnswer(q)
        : html`<div class="qr-compare">
            <div class="qr-col">
              <div class="qr-label">Your answer · ${q.seconds_used ?? 0}s</div>
              <div class="qr-text ${q.user_answer ? '' : raw('is-empty')}">${q.user_answer ?? 'No answer.'}</div>
            </div>
            <div class="qr-col qr-model">
              <div class="qr-label">Model answer</div>
              <div class="qr-text">${q.model_answer}</div>
            </div>
          </div>`}
      <p class="qr-feedback">${q.feedback}</p>
    </article>`;
}

function setStats(set) {
  const mins = set.avg_seconds != null ? `${Math.round(set.avg_seconds)}s average per question` : '';
  return html`<div class="meta-row" style="margin:0 0 16px">
    <span>${set.timeouts ?? 0} timed out</span>${mins ? html`<span>${mins}</span>` : ''}</div>`;
}

function evaluating(label) {
  return html`<div class="card">
    <p class="status-line">${raw(icon('loader-circle', 'spin'))}${label}</p>
    <div class="skeleton skeleton-line w-80"></div>
    <div class="skeleton skeleton-line w-60"></div>
    <div class="skeleton skeleton-line w-80"></div>
  </div>`;
}

function evalFailed(setId) {
  return html`<div class="card row">
    <p class="form-error" style="margin:0">Scoring failed this time.</p>
    <button class="btn btn-ghost btn-sm" type="button" data-retry-eval="${setId}">${raw(icon('refresh-cw'))}Retry</button>
  </div>`;
}

// ---------- Extra rounds ----------
function extraRoundView(set, expanded) {
  if (set.status === 'evaluated') {
    return html`<div class="card extra-card">
      <button class="extra-head" type="button" data-toggle="${set.id}" aria-expanded="${String(expanded)}">
        <span class="row"><span class="pill">${levelLabel(set.level)}</span>
          <span class="extra-summary">${set.verdict?.summary ?? ''}</span></span>
        <span class="row">${score(set.score, 'score-sm')}${raw(icon('chevron-right', 'chev'))}</span>
      </button>
      ${expanded ? html`<div class="extra-body">
        ${setStats(set)}
        ${set.questions.map(questionReview)}
        ${set.verdict ? workOnNext(set.verdict) : ''}
      </div>` : ''}
    </div>`;
  }
  if (set.eval_status === 'failed') return evalFailed(set.id);
  if (set.status === 'answered') return evaluating(`Scoring your ${levelLabel(set.level).toLowerCase()} round…`);
  if (set.gen_status === 'failed') {
    return html`<div class="card"><p class="form-error" style="margin:0">Couldn't write this round. Pick a level to try again.</p></div>`;
  }
  if (set.gen_status === 'pending') {
    return html`<div class="card"><p class="status-line">${raw(icon('loader-circle', 'spin'))}
      Writing 10 ${levelLabel(set.level).toLowerCase()} questions…</p></div>`;
  }
  if (set.status === 'not_started') {
    return html`<div class="card start-bar" style="position:static;margin-top:0">
      <p class="status-line">${raw(icon('circle-check'))}Your ${levelLabel(set.level).toLowerCase()} round is ready. Same rules: timed, no going back.</p>
      <button class="btn btn-primary" type="button" data-start-extra="${set.id}">Start round ${raw(icon('arrow-right'))}</button>
    </div>`;
  }
  return html`<div id="extra-live" data-set="${set.id}"></div>`; // in progress: interview mounts here
}

// ---------- Main ----------
export function renderVerdict(container, session, { setHeaderPill }) {
  let r = null;
  let timer = null;
  let liveCleanup = null;
  const expanded = new Set();

  const needsPoll = () => {
    if (!r) return true;
    const sets = [r.main, ...r.extras].filter(Boolean);
    return sets.some((s) => (s.status === 'answered' && s.eval_status === 'pending') || s.gen_status === 'pending');
  };

  function draw() {
    liveCleanup?.();
    liveCleanup = null;
    const main = r.main;

    if (main.eval_status === 'failed') {
      container.innerHTML = evalFailed(main.id).toString();
      return;
    }
    if (main.status !== 'evaluated') {
      container.innerHTML = html`
        <h2 class="section-heading">Verdict</h2>
        ${evaluating('The interviewer is reading your answers. This takes a minute or two…')}`.toString();
      return;
    }

    const busyExtra = r.extras.some((x) => x.status !== 'evaluated' && x.eval_status !== 'failed' && x.gen_status !== 'failed');
    container.innerHTML = html`
      <section class="verdict-hero card">
        <div class="verdict-score">
          ${score(r.overall_score, 'score-xl')}<span class="score-of">/10</span>
        </div>
        <div class="verdict-side">
          <p class="verdict-summary">${r.verdict.summary}</p>
          <div class="verdict-split">
            <span>Comprehension ${score(r.comprehension_score, 'score-inline')}<span class="hint"> · 40%</span></span>
            <span>Interview ${score(r.interview_score, 'score-inline')}<span class="hint"> · 60%</span></span>
          </div>
        </div>
      </section>

      <section class="section">${workOnNext(r.verdict)}</section>

      <section class="section">
        <h2 class="section-heading">Comprehension</h2>
        <div class="card dims">
          ${r.comprehension.map((c) => html`
            <div class="dim">
              <div class="dim-head"><span class="dim-label">${c.label}</span>${score(c.score, 'score-sm')}</div>
              <p class="dim-critique">${c.critique}</p>
            </div>`)}
        </div>
      </section>

      <section class="section">
        <h2 class="section-heading">Interview</h2>
        ${setStats(main)}
        ${main.questions.map(questionReview)}
      </section>

      <section class="section" id="extras">
        <h2 class="section-heading">Extra rounds</h2>
        <p class="hint write-intro">Ten more questions at the level you choose. They count toward your framework analytics, not this session's score.</p>
        ${r.extras.map((x) => extraRoundView(x, expanded.has(x.id)))}
        <div class="row extra-levels">
          ${LEVELS.map((l) => html`<button class="btn btn-ghost" type="button" data-level="${l.key}" ${busyExtra ? raw('disabled') : ''}>${l.label}</button>`)}
        </div>
      </section>`.toString();

    const live = $('#extra-live', container);
    if (live) {
      liveCleanup = renderInterview(live, {
        sessionId: session.id,
        setId: Number(live.dataset.set),
        onProgress: (q) => setHeaderPill(`Extra round · Q${q.position}/${q.total}`),
        onDone: () => { setHeaderPill(null); refresh(); },
      });
    }
  }

  async function refresh() {
    clearTimeout(timer);
    try {
      r = await api(`/sessions/${session.id}/results`);
      draw();
    } catch (err) {
      toast(err.message);
    }
    if (needsPoll()) timer = setTimeout(refresh, 4000);
  }

  container.addEventListener('click', async (e) => {
    const t = e.target.closest('[data-level], [data-start-extra], [data-retry-eval], [data-toggle]');
    if (!t) return;
    try {
      if (t.dataset.toggle) {
        const id = Number(t.dataset.toggle);
        if (expanded.has(id)) expanded.delete(id); else expanded.add(id);
        draw();
        return;
      }
      t.disabled = true;
      if (t.dataset.level) r = await api(`/sessions/${session.id}/extra`, { method: 'POST', body: { level: t.dataset.level } });
      if (t.dataset.startExtra) r = await api(`/sessions/${session.id}/sets/${t.dataset.startExtra}/start`, { method: 'POST' });
      if (t.dataset.retryEval) r = await api(`/sessions/${session.id}/sets/${t.dataset.retryEval}/evaluation/retry`, { method: 'POST' });
      draw();
      clearTimeout(timer);
      if (needsPoll()) timer = setTimeout(refresh, 3000);
    } catch (err) {
      toast(err.message);
      refresh();
    }
  });

  container.innerHTML = evaluating('Loading your verdict…').toString();
  refresh();
  return () => { clearTimeout(timer); liveCleanup?.(); };
}
