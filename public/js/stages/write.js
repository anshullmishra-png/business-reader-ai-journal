// Stage 2: the 100–200 word comprehension. Locked for good once submitted.
import { html, raw, $, toast } from '../lib/dom.js';
import { api } from '../lib/api.js';
import { icon } from '../lib/icons.js';
import { appState } from '../app.js';
import { comprehensionWords, MIN_WORDS, MAX_WORDS, TEMPLATE_LABELS, TEMPLATE_TEXT } from '../lib/words.js';
import { stageHeading } from '../lib/format.js';

// Drafts live in this browser only, so a reload doesn't lose work.
const draftKey = (id) => `brj:draft:${id}`;
function loadDraft(id) {
  try { return JSON.parse(localStorage.getItem(draftKey(id))) ?? {}; } catch { return {}; }
}
function saveDraft(id, draft) {
  try { localStorage.setItem(draftKey(id), JSON.stringify(draft)); } catch { /* storage unavailable */ }
}
function clearDraft(id) {
  try { localStorage.removeItem(draftKey(id)); } catch { /* ignore */ }
}

const hasTemplate = (text) => TEMPLATE_LABELS.some((l) => text.includes(l));
const stripTemplate = (text) =>
  TEMPLATE_LABELS.reduce((t, l) => t.split(`${l}\n`).join('').split(l).join(''), text).replace(/^\s+/, '');

const fmtElapsed = (ms) => {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};

export function renderWrite(container, session, { onSubmitted }) {
  const id = session.id;
  const draft = loadDraft(id);
  const templateOn = draft.template ?? Boolean(appState.user?.template_default);
  let startedAt = draft.startedAt ?? null;

  container.innerHTML = html`
    ${stageHeading('write')}
    <p class="hint write-intro">${session.url ? 'Read the article on the original site first.' : 'Read the article above first.'} Then condense it in ${MIN_WORDS}–${MAX_WORDS} words:
      what happened, why it matters, how the money works, and what you'd do. Once you submit, it's locked.</p>

    <div class="write-bar">
      <label class="switch">
        <input type="checkbox" id="template-toggle" ${templateOn ? raw('checked') : ''}>
        Use the template
      </label>
      <span class="elapsed" id="elapsed" ${startedAt ? '' : raw('hidden')} title="Time since your first keystroke">
        ${raw(icon('clock'))}<span id="elapsed-time">0:00</span>
      </span>
    </div>

    <div class="editor-wrap">
      <label class="visually-hidden" for="editor">Your comprehension</label>
      <textarea id="editor" class="editor" spellcheck="true"
        placeholder="Start writing. What happened, and why should a founder care?"></textarea>
      <div class="word-meter" id="word-meter" aria-hidden="true"><span id="word-fill"></span><i></i></div>
      <div class="editor-foot">
        <div class="foot-status">
          <span class="word-count" id="word-count" aria-live="polite"></span>
          <span class="saved-at" id="saved-at"></span>
        </div>
        <div class="row">
          <span class="hint keys"><span class="kbd">Ctrl</span>+<span class="kbd">Enter</span></span>
          <button class="btn btn-primary" id="submit-write" type="button" disabled>${raw(icon('lock'))}Submit and lock</button>
        </div>
      </div>
    </div>`.toString();

  const editor = $('#editor', container);
  const toggle = $('#template-toggle', container);
  const counter = $('#word-count', container);
  const submitBtn = $('#submit-write', container);
  const elapsedEl = $('#elapsed', container);
  const elapsedTime = $('#elapsed-time', container);
  const meter = $('#word-meter', container);
  const fill = $('#word-fill', container);
  const savedAt = $('#saved-at', container);
  let lastSaved = null;
  const showSaved = () => {
    if (!lastSaved) return;
    const s = Math.round((Date.now() - lastSaved) / 1000);
    savedAt.textContent = `Saved on this device · ${s < 5 ? 'just now' : s < 60 ? `${s}s ago` : `${Math.floor(s / 60)} min ago`}`;
  };

  editor.value = draft.text ?? (templateOn ? TEMPLATE_TEXT : '');

  const autosize = () => {
    editor.style.height = 'auto';
    editor.style.height = `${Math.max(editor.scrollHeight, 320)}px`;
  };

  const update = () => {
    const n = comprehensionWords(editor.value);
    const ok = n >= MIN_WORDS && n <= MAX_WORDS;
    counter.textContent = n > MAX_WORDS
      ? `${n} words · ${n - MAX_WORDS} over the ${MAX_WORDS} limit`
      : n < MIN_WORDS
        ? `${n} words · ${MIN_WORDS - n} more to go`
        : `${n} words`;
    counter.dataset.state = ok ? 'ok' : n > MAX_WORDS ? 'over' : 'under';
    // The meter fills to the 200-word limit; the notch marks the 100-word minimum.
    fill.style.width = `${Math.min(100, (n / MAX_WORDS) * 100)}%`;
    meter.dataset.state = counter.dataset.state;
    submitBtn.disabled = !ok;
    autosize();
    if (editor.value !== (draft.text ?? '') || lastSaved) {
      saveDraft(id, { text: editor.value, startedAt, template: toggle.checked });
      lastSaved = Date.now();
      showSaved();
    }
  };

  const tick = () => {
    if (startedAt) elapsedTime.textContent = fmtElapsed(Date.now() - startedAt);
    showSaved();
  };
  const timer = setInterval(tick, 1000);
  tick();

  editor.addEventListener('input', () => {
    if (!startedAt) {
      startedAt = Date.now();
      elapsedEl.hidden = false;
    }
    update();
  });

  toggle.addEventListener('change', () => {
    if (toggle.checked && !hasTemplate(editor.value)) {
      editor.value = editor.value.trim() ? `${TEMPLATE_TEXT}\n${editor.value}` : TEMPLATE_TEXT;
    } else if (!toggle.checked) {
      editor.value = stripTemplate(editor.value);
    }
    update();
    editor.focus({ preventScroll: true });
    // Remember the choice for next time.
    api('/me/settings', { method: 'PATCH', body: { template_default: toggle.checked } })
      .then((u) => { appState.user = u; })
      .catch(() => {});
  });

  async function submit() {
    if (submitBtn.disabled) return;
    submitBtn.disabled = true;
    editor.readOnly = true;
    submitBtn.innerHTML = `${icon('loader-circle', 'spin')}Locking…`;
    const seconds = startedAt ? Math.round((Date.now() - startedAt) / 1000) : 0;
    try {
      const updated = await api(`/sessions/${id}/comprehension`, {
        method: 'POST',
        body: { text: editor.value, seconds },
      });
      clearDraft(id);
      onSubmitted(updated);
    } catch (err) {
      editor.readOnly = false;
      submitBtn.innerHTML = `${icon('lock')}Submit and lock`;
      if (err.status === 409) {
        clearDraft(id);
        onSubmitted(await api(`/sessions/${id}`));
        return;
      }
      toast(err.message);
      update();
    }
  }

  submitBtn.addEventListener('click', submit);
  editor.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && e.ctrlKey) {
      e.preventDefault();
      submit();
    }
  });

  update();
  // Ready to type on a computer, without scrolling past the title and article.
  // On touch screens the keyboard would cover the page, so wait for a tap.
  if (window.matchMedia('(pointer: fine)').matches) {
    editor.focus({ preventScroll: true });
    editor.setSelectionRange(editor.value.length, editor.value.length);
  }

  return () => clearInterval(timer);
}

// Read-only view once the stage is locked.
export function renderLockedComprehension(container, session) {
  const secs = session.comprehension_seconds ?? 0;
  const mins = Math.floor(secs / 60);
  container.innerHTML = html`
    ${stageHeading('write', 'Locked')}
    <div class="card locked-card">
      <div class="locked-meta">
        <span class="row">${raw(icon('lock'))}Locked</span>
        <span>${comprehensionWords(session.comprehension_text)} words</span>
        <span>${mins ? `${mins} min ` : ''}${secs % 60} sec to write</span>
      </div>
      <div class="prose locked-text">${session.comprehension_text}</div>
    </div>`.toString();
}
