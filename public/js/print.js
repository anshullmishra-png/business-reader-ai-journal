// Builds the print-optimised reports: session, weekly review, portfolio.
// Charts are drawn once at 2x and swapped for <img> so they print crisply.
import { html, raw, $, scoreClass } from './lib/dom.js';
import { api } from './lib/api.js';
import { SOURCE_LABELS, fmtDate, fmtScore, fmtMaybeDate } from './lib/format.js';
import { comprehensionWords } from './lib/words.js';
import { loadChart, C, SERIES, dayLabels } from './lib/charts.js';

const TYPE_LABELS = { mcq: 'Multiple choice', short: 'Short answer', structured: 'Structured', estimation: 'Estimation' };
const LEVEL_LABELS = { easy: 'Easy', medium: 'Medium', hard: 'Hard', super_hard: 'Super hard' };
const sc = (n, cls = '') => html`<span class="score ${cls} ${scoreClass(n)}">${fmtScore(n)}</span>`;
const today = () => fmtDate(new Date().toISOString());

// ---------- Charts → images ----------
async function chartImage(config, { width = 680, height = 260 } = {}) {
  const Chart = await loadChart();
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  canvas.style.width = `${width}px`;
  canvas.style.height = `${height}px`;
  const holder = document.createElement('div');
  holder.style.cssText = `position:fixed;left:-10000px;top:0;width:${width}px;height:${height}px`;
  holder.append(canvas);
  document.body.append(holder);
  const chart = new Chart(canvas, {
    ...config,
    options: { ...config.options, responsive: false, animation: false, devicePixelRatio: 2 },
  });
  const src = chart.toBase64Image('image/png', 1);
  chart.destroy();
  holder.remove();
  return src;
}

// ---------- Shared pieces ----------
function questionBlock(q) {
  const picked = q.user_answer == null ? null : Number(q.user_answer);
  return html`<div class="q">
    <div class="q-head">
      <span class="q-tags">Q${q.position} · ${TYPE_LABELS[q.type]} · ${q.framework}${q.timed_out ? ' · timed out' : ''}</span>
      ${sc(q.score)}
    </div>
    <p class="q-prompt">${q.prompt}</p>
    ${q.type === 'mcq'
      ? html`<ol class="mcq">${q.options.map((o, i) => html`<li data-state="${i === q.correct_option ? 'correct' : i === picked ? 'wrong' : ''}">${o}${i === picked ? ' (your pick)' : ''}</li>`)}</ol>
        <p class="r-small r-muted"><strong>Why:</strong> ${q.model_answer}</p>`
      : html`<div class="q-cols">
          <div class="q-col"><div class="q-col-label">Your answer · ${q.seconds_used ?? 0}s</div><div class="pre">${q.user_answer ?? 'No answer.'}</div></div>
          <div class="q-col"><div class="q-col-label">Model answer</div><div class="pre">${q.model_answer}</div></div>
        </div>`}
    <p class="q-feedback">${q.feedback}</p>
  </div>`;
}

function workOnNext(v) {
  return html`<ol class="list">${v.work_on_next.map((w) => html`<li><strong>${w.title}.</strong> ${w.detail} <span class="r-muted">(${w.target})</span></li>`)}</ol>`;
}

// ---------- Session report ----------
async function sessionReport(id) {
  const [s, r, settings] = await Promise.all([api(`/sessions/${id}`), api(`/sessions/${id}/results`), api('/me')]);
  document.title = `${s.title} · Session report`;
  if (r.main?.status !== 'evaluated') {
    return html`<p class="r-prose">This session hasn't been scored yet. The report is available once the verdict is in.</p>`;
  }
  const published = fmtMaybeDate(s.published_at);
  const extras = r.extras.filter((x) => x.status === 'evaluated');
  return html`
    <div class="r-kicker">Session report${settings.name ? ` · ${settings.name}` : ''}</div>
    <h1 class="r-title">${s.title}</h1>
    <div class="r-meta">
      <span>${SOURCE_LABELS[s.source]}</span>${s.tags?.sector ? html`<span>${s.tags.sector}</span>` : ''}
      <span>Read ${fmtDate(s.created_at)}</span>${published ? html`<span>Published ${published}</span>` : ''}
    </div>

    <div class="hero block">
      <div><span class="score hero-score ${scoreClass(r.overall_score)}">${fmtScore(r.overall_score)}</span><span class="hero-of">/10</span></div>
      <div>
        <p class="r-prose">${r.verdict.summary}</p>
        <div class="hero-split"><span>Comprehension ${sc(r.comprehension_score)} · 40%</span><span>Interview ${sc(r.interview_score)} · 60%</span>
          <span>${r.main.timeouts ?? 0} timed out · ${Math.round(r.main.avg_seconds ?? 0)}s avg per question</span></div>
      </div>
    </div>

    <h2 class="r-h2">Work on this next</h2>
    ${workOnNext(r.verdict)}

    <h2 class="r-h2">Comprehension · ${comprehensionWords(s.comprehension_text)} words</h2>
    <div class="two">
      <div class="block flow"><p class="r-prose pre">${s.comprehension_text}</p></div>
      <div class="block flow">${r.comprehension.map((c) => html`<div class="dim"><strong>${c.label}</strong>${sc(c.score)}<span class="dim-crit">${c.critique}</span></div>`)}</div>
    </div>

    <h2 class="r-h2">Interview</h2>
    ${r.main.questions.map(questionBlock)}

    ${extras.length ? html`<h2 class="r-h2">Extra rounds</h2>
      <table class="t"><thead><tr><th>Level</th><th>Verdict</th><th class="num">Score</th></tr></thead>
      <tbody>${extras.map((x) => html`<tr><td>${LEVEL_LABELS[x.level]}</td><td>${x.verdict?.summary ?? ''}</td><td class="num">${sc(x.score)}</td></tr>`)}</tbody></table>` : ''}

    <p class="r-footer-note">Generated ${today()} by Business Reads Journal. Scores are from an AI interviewer calibrated so 5/10 is an acceptable first-round answer.</p>`;
}

// ---------- Weekly review report ----------
async function reviewReport(id) {
  const [{ reviews }, settings] = await Promise.all([api('/reviews'), api('/me')]);
  const r = reviews.find((x) => x.id === Number(id));
  if (!r) return html`<p class="r-prose">Review not found.</p>`;
  const c = r.content;
  const s = c.stats ?? {};
  document.title = `Weekly review ${fmtDate(r.period_start)} · Business Reads Journal`;
  const points = (list) => html`<ul class="list">${list.map((p) => html`<li><strong>${p.point}</strong><br><span class="r-muted">${p.evidence}</span></li>`)}</ul>`;
  return html`
    <div class="r-kicker">Weekly review${settings.name ? ` · ${settings.name}` : ''}</div>
    <h1 class="r-title">${c.headline}</h1>
    <div class="r-meta"><span>${fmtDate(r.period_start)} – ${fmtDate(r.period_end)}</span><span>${r.session_ids.length} sessions</span></div>

    <h2 class="r-h2">The numbers</h2>
    <div class="tiles">
      <div class="tile"><div class="tile-label">Overall</div><div class="tile-value ${scoreClass(s.overall)}">${fmtScore(s.overall)}</div></div>
      <div class="tile"><div class="tile-label">Comprehension</div><div class="tile-value ${scoreClass(s.comprehension)}">${fmtScore(s.comprehension)}</div></div>
      <div class="tile"><div class="tile-label">Interview</div><div class="tile-value ${scoreClass(s.interview)}">${fmtScore(s.interview)}</div></div>
      <div class="tile"><div class="tile-label">Timeout rate</div><div class="tile-value">${s.timeout_rate ?? '—'}%</div></div>
      <div class="tile"><div class="tile-label">Avg time / question</div><div class="tile-value">${s.avg_seconds ?? '—'}s</div></div>
      <div class="tile"><div class="tile-label">Avg words written</div><div class="tile-value">${s.words ?? '—'}</div></div>
    </div>

    <div class="two" style="margin-top:6pt">
      <div><h2 class="r-h2">What improved</h2>${points(c.improved)}</div>
      <div><h2 class="r-h2">Still weak</h2>${points(c.still_weak)}</div>
    </div>
    <h2 class="r-h2">Patterns</h2><ul class="list r-prose">${c.patterns.map((p) => html`<li>${p}</li>`)}</ul>
    <div style="break-inside:avoid"><h2 class="r-h2">Goals for next week</h2><ol class="list r-prose">${c.goals.map((g) => html`<li>${g}</li>`)}</ol></div>
    <div class="block" style="margin-top:14pt"><p class="r-prose"><strong>Verdict.</strong> ${c.verdict}</p></div>
    <p class="r-footer-note">Generated ${today()} by Business Reads Journal.</p>`;
}

// ---------- Portfolio report ----------
async function portfolioReport() {
  const [p, sessions, { reviews }, settings] = await Promise.all([
    api('/progress?window=all'), api('/sessions'), api('/reviews'), api('/me'),
  ]);
  document.title = 'Portfolio report · Business Reads Journal';
  const h = p.headline;
  const scored = sessions.filter((s) => s.overall_score != null).sort((a, b) => a.created_at.localeCompare(b.created_at));
  if (!scored.length) return html`<p class="r-prose">The portfolio report needs at least one scored session.</p>`;

  const fw = p.frameworks.all.filter((f) => f.n);
  const strongest = [...fw].sort((a, b) => b.avg - a.avg).slice(0, 3);
  const weakest = p.frameworks.weakest;
  const t = p.trend;

  const [trendImg, radarImg, diffImg] = await Promise.all([
    chartImage({
      type: 'line',
      data: {
        labels: dayLabels(t.map((x) => x.date)),
        datasets: [['Overall', 'overall'], ['Interview', 'interview'], ['Comprehension', 'comprehension']].map(([label, k], i) => ({
          label, data: t.map((x) => x[k]), borderColor: SERIES[i].color, backgroundColor: SERIES[i].color, borderDash: SERIES[i].dash,
          pointRadius: 2,
        })),
      },
      options: { plugins: { legend: { position: 'top' } }, scales: { y: { min: 0, max: 10, ticks: { stepSize: 2 } }, x: { grid: { display: false } } } },
    }, { width: 680, height: 240 }),
    chartImage({
      type: 'radar',
      data: { labels: p.frameworks.all.map((f) => f.framework), datasets: [{ label: 'Average', data: p.frameworks.all.map((f) => f.avg),
        borderColor: C.ink, backgroundColor: 'rgba(24,24,27,0.08)', pointRadius: 2, pointBackgroundColor: C.ink }] },
      options: { plugins: { legend: { display: false } }, scales: { r: { min: 0, max: 10, ticks: { stepSize: 2, backdropColor: 'transparent' },
        pointLabels: { font: { size: 10 }, color: C.mid } } } },
    }, { width: 400, height: 340 }),
    chartImage({
      type: 'line',
      data: { labels: dayLabels(p.difficulty_history.map((x) => x.created_at)),
        datasets: [{ label: 'Level', data: p.difficulty_history.map((x) => x.level), stepped: true, borderColor: C.ink, pointRadius: 0 }] },
      options: { plugins: { legend: { display: false } }, scales: { y: { min: 1, max: 10, ticks: { stepSize: 3 } }, x: { grid: { display: false } } } },
    }, { width: 330, height: 140 }), // drawn at the printed column width so text isn't enlarged
  ]);

  const r = p.readiness;
  return html`
    <div class="r-kicker">Portfolio report · ${fmtDate(scored[0].created_at)} – ${fmtDate(scored[scored.length - 1].created_at)}</div>
    <h1 class="r-title">${settings.name ? `${settings.name}: ` : ''}Chief of Staff interview practice</h1>
    <p class="r-prose r-muted" style="margin-top:4pt">Daily business reading (The Ken, The Arc, Entrackr and others) turned into timed interview practice,
      scored by a deliberately tough AI interviewer. 5/10 means an acceptable first-round answer; 8+ needs numbers, structure and a non-obvious insight.</p>

    <h2 class="r-h2">Headline</h2>
    <div class="tiles">
      <div class="tile"><div class="tile-label">Interview readiness</div><div class="tile-value">${r.value ?? '—'}<span class="r-small r-muted"> /100</span></div></div>
      <div class="tile"><div class="tile-label">Articles read</div><div class="tile-value">${h.total_articles}</div></div>
      <div class="tile"><div class="tile-label">Scored sessions</div><div class="tile-value">${scored.length}</div></div>
      <div class="tile"><div class="tile-label">Avg score, last 7</div><div class="tile-value ${scoreClass(h.avg_last7)}">${fmtScore(h.avg_last7)}</div></div>
      <div class="tile"><div class="tile-label">Difficulty level</div><div class="tile-value">${h.difficulty}/10</div></div>
      <div class="tile"><div class="tile-label">Glossary</div><div class="tile-value">${h.glossary_size} terms</div></div>
    </div>
    <p class="r-small r-muted" style="margin-top:4pt">Readiness = ${r.parts.map((x) => `${x.weight}% ${x.label.toLowerCase()} (${x.value})`).join(' + ')}.</p>

    <h2 class="r-h2">Score trend</h2>
    <div class="chart-box"><img class="chart-img" src="${trendImg}" alt="Score trend: overall, interview and comprehension per session"></div>

    <div class="two" style="margin-top:6pt">
      <div class="chart-box"><div class="chart-cap">Average score by framework</div><img class="chart-img" src="${radarImg}" alt="Framework radar"></div>
      <div>
        <div class="chart-cap">Strongest frameworks</div>
        <table class="t"><tbody>${strongest.map((f) => html`<tr><td>${f.framework}</td><td class="num">${sc(f.avg)}</td><td class="num r-muted">${f.n} q</td></tr>`)}</tbody></table>
        <div class="chart-cap" style="margin-top:10pt">Weakest frameworks</div>
        <table class="t"><tbody>${weakest.map((f) => html`<tr><td>${f.framework}</td><td class="num">${sc(f.avg)}</td><td class="num r-muted">${f.n} q</td></tr>`)}</tbody></table>
        <div class="chart-cap" style="margin-top:10pt">Difficulty level over time</div>
        <img class="chart-img" src="${diffImg}" alt="Difficulty level over time">
      </div>
    </div>

    <h2 class="r-h2">Discipline and coverage</h2>
    <div class="tiles">
      <div class="tile"><div class="tile-label">Timeout rate</div><div class="tile-value">${p.current?.timeout_rate ?? '—'}%</div></div>
      <div class="tile"><div class="tile-label">Avg time / question</div><div class="tile-value">${p.current?.avg_seconds ?? '—'}s</div></div>
      <div class="tile"><div class="tile-label">Sectors covered</div><div class="tile-value">${p.sectors.counts.length}</div></div>
    </div>
    <p class="r-small r-muted" style="margin-top:4pt">Sectors read: ${p.sectors.counts.map((x) => `${x.sector} (${x.n})`).join(', ') || '—'}.</p>

    <h2 class="r-h2 page-break">Every session</h2>
    <table class="t">
      <thead><tr><th>Date</th><th>Article</th><th>Source</th><th class="num">Comp.</th><th class="num">Interview</th><th class="num">Overall</th></tr></thead>
      <tbody>${scored.map((s) => html`<tr><td>${fmtDate(s.created_at)}</td><td>${s.title}</td><td>${SOURCE_LABELS[s.source]}</td>
        <td class="num">${fmtScore(s.comprehension_score)}</td><td class="num">${fmtScore(s.interview_score)}</td><td class="num">${sc(s.overall_score)}</td></tr>`)}</tbody>
    </table>

    ${reviews.length ? html`<h2 class="r-h2">Weekly review verdicts</h2>
      ${reviews.map((rv) => html`<div class="block"><div class="r-kicker">${fmtDate(rv.period_start)} – ${fmtDate(rv.period_end)}</div>
        <p class="r-prose"><strong>${rv.content.headline}</strong> ${rv.content.verdict}</p></div>`)}` : ''}

    <p class="r-footer-note">Generated ${today()} by Business Reads Journal, an app that uses AI as a demanding interview tutor.
      Article text is never included in reports.</p>`;
}

// ---------- Boot ----------
async function boot() {
  const path = location.pathname.replace(/\/+$/, '');
  const [, kind, id] = path.match(/^\/print\/(session|review|portfolio)(?:\/(\d+))?$/) ?? [];
  const report = $('#report');
  try {
    const content = kind === 'session' ? await sessionReport(id)
      : kind === 'review' ? await reviewReport(id)
        : await portfolioReport();
    report.innerHTML = content.toString();
  } catch (err) {
    report.innerHTML = html`<p class="r-prose">Couldn't build this report: ${err.message}</p>`.toString();
  }

  // Wait for fonts and images so the PDF is complete.
  await document.fonts.ready;
  await Promise.all([...document.images].map((img) => (img.complete ? null : new Promise((r) => { img.onload = r; img.onerror = r; }))));

  const btn = $('#tb-print');
  btn.disabled = false;
  btn.addEventListener('click', () => window.print());
  $('#tb-hint').textContent = 'In the print dialog, choose "Save as PDF" as the destination.';
  document.body.dataset.ready = 'true';
  if (new URLSearchParams(location.search).has('autoprint')) setTimeout(() => window.print(), 300);
}

boot();
