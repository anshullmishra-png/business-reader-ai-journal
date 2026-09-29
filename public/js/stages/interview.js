// Stage 4: the timed interview, one question at a time, no going back.
// Used for the main interview and for extra rounds.
import { html, raw, $, $$, toast } from '../lib/dom.js';
import { api } from '../lib/api.js';
import { icon } from '../lib/icons.js';

const TYPE_LABELS = { mcq: 'Multiple choice', short: 'Short answer', structured: 'Structured', estimation: 'Estimation' };
const PLACEHOLDERS = {
  short: 'Answer in 1–3 crisp sentences.',
  structured: '3–4 bullets. Make them MECE.\n- \n- \n- ',
  estimation: 'Your number first. Then 2–4 lines of assumptions.',
};
const WARN_SECONDS = 10;

// Unsent answer text survives a reload (the clock keeps running on the server).
const draftKey = (qid) => `brj:answer:${qid}`;
const readDraft = (qid) => { try { return localStorage.getItem(draftKey(qid)) ?? ''; } catch { return ''; } };
const writeDraft = (qid, v) => { try { localStorage.setItem(draftKey(qid), v); } catch { /* ignore */ } };
const dropDraft = (qid) => { try { localStorage.removeItem(draftKey(qid)); } catch { /* ignore */ } };

/**
 * @param {HTMLElement} container
 * @param {{ sessionId:number, setId:number, onProgress:(q)=>void, onDone:()=>void }} o
 */
export function renderInterview(container, { sessionId, setId, onProgress, onDone, heading = '' }) {
  const base = `/sessions/${sessionId}/sets/${setId}`;
  let q = null;
  let deadline = 0;       // in this browser's clock
  let submitting = false;
  let selected = null;    // MCQ choice
  let stopped = false;

  function answerValue() {
    if (q.type === 'mcq') return selected == null ? null : String(selected);
    const v = $('#answer', container)?.value ?? '';
    return v.trim() ? v : null;
  }

  async function submit(auto = false) {
    if (submitting || !q) return;
    submitting = true;
    for (const b of $$('button, textarea', container)) b.disabled = true;
    const qid = q.id;
    try {
      const res = await api(`${base}/answer`, {
        method: 'POST',
        body: { question_id: qid, answer: answerValue(), auto_submitted: auto },
      });
      dropDraft(qid);
      show(res.next);
    } catch (err) {
      // 409 means this question was already locked (e.g. another tab): move on.
      if (err.status === 409) {
        dropDraft(qid);
        show(await api(`${base}/current`));
      } else {
        submitting = false;
        for (const b of $$('button, textarea', container)) b.disabled = false;
        toast(err.message);
      }
    }
  }

  // Runs every 100ms from a plain interval (not requestAnimationFrame, which
  // stops in background tabs), so the auto-submit always fires at zero.
  function tick() {
    if (stopped || !q || submitting) return;
    const total = q.timer_seconds * 1000;
    const left = Math.max(0, deadline - Date.now());
    const bar = $('#timer-fill', container);
    const label = $('#timer-label', container);
    if (bar) {
      bar.style.transform = `scaleX(${left / total})`;
      bar.parentElement.dataset.warn = String(left <= WARN_SECONDS * 1000);
    }
    if (label) label.textContent = `${Math.ceil(left / 1000)}s`;
    if (left <= 0) submit(true); // auto-submit whatever is typed or selected
  }

  function show(next) {
    submitting = false;
    selected = null;
    if (next.done) {
      q = null;
      container.innerHTML = html`<div class="card interview-done">
        <p class="status-line">${raw(icon('loader-circle', 'spin'))}Interview complete. The interviewer is reading your answers…</p></div>`.toString();
      onDone?.();
      return;
    }
    q = next;
    // Convert the server deadline into this browser's clock.
    deadline = Date.now() + (Date.parse(q.deadline) - Date.parse(q.server_now));
    onProgress?.(q);

    const draft = readDraft(q.id);
    container.innerHTML = html`
      ${heading}
      <div class="timer" id="timer" role="timer" aria-label="Time left">
        <div class="timer-track"><div class="timer-fill" id="timer-fill"></div></div>
        <span class="timer-label" id="timer-label"></span>
      </div>

      <div class="q-count">Question ${q.position} of ${q.total}</div>
      <h2 class="q-prompt">${q.prompt}</h2>

      <div class="bento q-bento">
        <div class="bento-tabs">
          <span class="pill pill-dark">${TYPE_LABELS[q.type]}</span>
          <span class="pill">${q.framework}</span>
          ${q.cross_article ? html`<span class="pill">${raw(icon('link'))}Earlier article</span>` : ''}
        </div>
        <div class="bento-body">
          ${q.type === 'mcq'
            ? html`<div class="options" role="radiogroup" aria-label="Options">
                ${q.options.map((o, i) => html`<button type="button" class="option" role="radio" aria-checked="false" data-option="${i}">
                  <span class="option-key">${i + 1}</span><span>${o}</span></button>`)}
              </div>`
            : html`<label class="visually-hidden" for="answer">Your answer</label>
              <textarea id="answer" class="answer" rows="5" maxlength="3000"
                placeholder="${PLACEHOLDERS[q.type]}">${draft}</textarea>`}
          <div class="q-foot">
            <span class="hint">${q.type === 'mcq' ? 'Keys 1–4 to choose · ' : ''}Ctrl+Enter to submit · no going back</span>
            <button class="btn btn-primary" type="button" id="submit-answer">Submit answer ${raw(icon('arrow-right'))}</button>
          </div>
        </div>
      </div>`.toString();

    const ta = $('#answer', container);
    if (ta) {
      ta.addEventListener('input', () => writeDraft(q.id, ta.value));
      ta.focus();
      ta.setSelectionRange(ta.value.length, ta.value.length);
    } else {
      $('.option', container)?.focus();
    }
    $('#submit-answer', container).addEventListener('click', () => submit(false));
    tick();
  }

  function choose(i) {
    if (!q || q.type !== 'mcq' || submitting) return;
    selected = i;
    for (const b of $$('.option', container)) {
      b.setAttribute('aria-checked', String(Number(b.dataset.option) === i));
    }
  }

  container.addEventListener('click', (e) => {
    const opt = e.target.closest('.option');
    if (opt) choose(Number(opt.dataset.option));
  });

  const onKey = (e) => {
    if (!q || submitting) return;
    if (e.key === 'Enter' && e.ctrlKey) {
      e.preventDefault();
      submit(false);
      return;
    }
    const typing = e.target instanceof HTMLElement && /^(INPUT|TEXTAREA)$/.test(e.target.tagName);
    if (q.type === 'mcq' && !typing && /^[1-4]$/.test(e.key)) choose(Number(e.key) - 1);
  };
  document.addEventListener('keydown', onKey);

  const clock = setInterval(tick, 100);

  container.innerHTML = html`<div class="card"><p class="status-line">${raw(icon('loader-circle', 'spin'))}Loading your question…</p></div>`.toString();
  api(`${base}/current`).then(show).catch((err) => toast(err.message));

  return () => {
    stopped = true;
    clearInterval(clock);
    document.removeEventListener('keydown', onKey);
  };
}
