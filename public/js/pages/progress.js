import { html, raw, $, $$, scoreClass } from '../lib/dom.js';
import { api } from '../lib/api.js';
import { icon } from '../lib/icons.js';
import { setHeader } from '../shell.js';
import { fmtScore } from '../lib/format.js';
import { loadChart, C, SERIES, lastPointAmber, dayLabels, endLabels } from '../lib/charts.js';

const WINDOWS = [
  { key: '7d', label: 'Last 7 days', prev: 'previous 7 days' },
  { key: '7a', label: 'Last 7 articles', prev: 'previous 7 articles' },
  { key: 'all', label: 'All time', prev: null },
];
const shortDate = (iso) => new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
const fmtSecs = (s) => (s == null ? '—' : s >= 60 ? `${Math.floor(s / 60)}m ${s % 60}s` : `${s}s`);

// Delta chip: "▲ 0.6 vs previous 7 articles". Higher isn't always better (timeouts).
function delta(cur, prev, { lowerIsBetter = false, unit = '', digits = 1 } = {}) {
  if (cur == null || prev == null) return '';
  const d = cur - prev;
  if (Math.abs(d) < 10 ** -digits / 2) return html`<span class="delta">no change</span>`;
  const better = lowerIsBetter ? d < 0 : d > 0;
  return html`<span class="delta ${better ? 'up' : 'down'}">${d > 0 ? '▲' : '▼'} ${Math.abs(d).toFixed(digits)}${unit}</span>`;
}

function tile(label, value, sub = '', cls = '') {
  return html`<div class="stat"><div class="stat-label">${label}</div>
    <div class="stat-value ${cls}">${value}</div>${sub ? html`<div class="stat-sub">${sub}</div>` : ''}</div>`;
}

function readinessTile(r) {
  return html`<div class="stat stat-hero">
    <div class="stat-label">Interview readiness
      <span class="info" tabindex="0" aria-describedby="readiness-tip">${raw(icon('info'))}
        <span class="info-tip" role="tooltip" id="readiness-tip">
          <strong>How it's calculated (0–100)</strong>
          ${r.parts.map((p) => html`<span class="tip-row"><span>${p.weight}% · ${p.label}</span><span>${p.value}</span></span>
            <span class="tip-how">${p.how}</span>`)}
        </span></span>
    </div>
    <div class="stat-value stat-xl">${r.value ?? '—'}</div>
    <div class="readiness-bar"><div style="width:${r.value ?? 0}%"></div></div>
  </div>`;
}

function chartCard(id, title, { table = false, height = 260, extra = '' } = {}) {
  return html`<div class="card chart-card">
    <div class="chart-head"><h3 class="chart-title">${title}</h3>
      ${table ? html`<button class="btn btn-ghost btn-sm" type="button" data-table-toggle="${id}">Table</button>` : ''}</div>
    <div class="chart-wrap" style="height:${height}px"><canvas id="${id}" role="img" aria-label="${title}"></canvas></div>
    <div class="chart-table" id="${id}-table" hidden></div>
    ${extra}
  </div>`;
}

export default async function render(el) {
  setHeader({ title: 'Progress' });
  el.classList.add('content-wide');
  let win = (() => { try { return localStorage.getItem('brj:progress-window') || '7a'; } catch { return '7a'; } })();
  const charts = [];
  const destroyCharts = () => { while (charts.length) charts.pop().destroy(); };

  el.innerHTML = html`
    <div class="progress-top">
      <div><h1 class="page-title">Progress</h1>
        <p class="page-lede">How your reading is turning into interview skill.</p></div>
      <div class="segmented" role="tablist" aria-label="Time window">
        ${WINDOWS.map((w) => html`<button type="button" role="tab" data-window="${w.key}">${w.label}</button>`)}
      </div>
    </div>
    <div id="progress-body"><div class="card"><div class="skeleton skeleton-line w-60"></div><div class="skeleton skeleton-line w-80"></div></div></div>`.toString();

  const body = $('#progress-body', el);

  async function draw() {
    for (const b of $$('[data-window]', el)) b.setAttribute('aria-selected', String(b.dataset.window === win));
    const [p, Chart] = await Promise.all([api(`/progress?window=${win}`), loadChart()]);
    destroyCharts();
    const w = WINDOWS.find((x) => x.key === win);
    const cur = p.current;
    const prev = p.previous;
    const h = p.headline;

    if (!h.total_articles || !p.trend.length && win === 'all') {
      body.innerHTML = html`<div class="empty">${raw(icon('chart-line'))}
        <div class="empty-title">Not enough data yet</div>Charts appear after your first scored session.</div>`.toString();
      return;
    }

    body.innerHTML = html`
      <section class="stats-grid">
        ${readinessTile(p.readiness)}
        ${tile('Articles read', h.total_articles)}
        ${tile('Reading streak', `${h.streak} day${h.streak === 1 ? '' : 's'}`)}
        ${tile('Avg score, last 7', fmtScore(h.avg_last7), h.avg_prev7 != null ? html`${delta(h.avg_last7, h.avg_prev7)} vs previous 7` : 'Needs more sessions', scoreClass(h.avg_last7))}
        ${tile('Difficulty', `${h.difficulty}/10`)}
        ${tile('Glossary', `${h.glossary_size} terms`)}
      </section>

      <section class="section">
        <h2 class="section-heading">${w.label}${cur?.sessions ? ` · ${cur.sessions} scored session${cur.sessions === 1 ? '' : 's'}` : ''}</h2>
        ${cur?.sessions ? html`<div class="stats-grid stats-3">
          ${tile('Overall', fmtScore(cur.overall), w.prev ? html`${delta(cur.overall, prev?.overall)} ${prev?.sessions ? `vs ${w.prev}` : `no ${w.prev} to compare`}` : '', scoreClass(cur.overall))}
          ${tile('Comprehension', fmtScore(cur.comprehension), w.prev ? delta(cur.comprehension, prev?.comprehension) : '', scoreClass(cur.comprehension))}
          ${tile('Interview', fmtScore(cur.interview), w.prev ? delta(cur.interview, prev?.interview) : '', scoreClass(cur.interview))}
        </div>
        ${chartCard('c-trend', 'Score trend', { table: true })}`
        : html`<div class="empty">No scored sessions in this window.</div>`}
      </section>

      <section class="section">
        <h2 class="section-heading">Framework strength</h2>
        ${chartCard('c-radar', 'Average score by framework', { height: 380 })}
        <div class="card" style="margin-top:12px">
            <h3 class="chart-title">Weakest frameworks</h3>
            ${p.frameworks.weakest.length ? html`<ol class="weak-list">${p.frameworks.weakest.map((f) => html`
              <li><span>${f.framework}</span><span class="${scoreClass(f.avg)}"><strong>${fmtScore(f.avg)}</strong></span>
                <span class="hint">${f.n} question${f.n === 1 ? '' : 's'}</span></li>`)}</ol>`
              : html`<p class="hint">No scored questions in this window.</p>`}
            <p class="hint" style="margin-top:14px">${p.frameworks.all.filter((f) => !f.n).length} of 16 frameworks not tested in this window.</p>
        </div>
      </section>

      <section class="section">
        <h2 class="section-heading">Comprehension craft</h2>
        <div class="stats-grid stats-3">
          ${tile('Avg words written', cur?.words ?? '—', w.prev ? delta(cur?.words, prev?.words, { digits: 0 }) : '')}
          ${tile('Avg time to write', fmtSecs(cur?.write_seconds))}
          ${tile('Avg clarity score', fmtScore(p.trend.length ? p.trend.reduce((a, t) => a + (t.clarity ?? 0), 0) / p.trend.length : null))}
        </div>
        ${p.trend.length ? chartCard('c-clarity', 'Condensation and clarity score per session', { height: 200 }) : ''}
      </section>

      <section class="section">
        <h2 class="section-heading">Interview discipline</h2>
        <div class="stats-grid stats-3">
          ${tile('Timeout rate', cur?.timeout_rate != null ? `${cur.timeout_rate}%` : '—', w.prev ? delta(cur?.timeout_rate, prev?.timeout_rate, { lowerIsBetter: true, unit: ' pts' }) : '')}
          ${tile('Avg time per question', cur?.avg_seconds != null ? `${cur.avg_seconds}s` : '—')}
          ${tile('Current difficulty', `${h.difficulty}/10`)}
        </div>
        ${chartCard('c-difficulty', 'Difficulty level over time', { height: 200 })}
      </section>

      <section class="section">
        <h2 class="section-heading">Sector coverage</h2>
        ${chartCard('c-sectors', `Articles by sector · ${w.label.toLowerCase()}`, { height: Math.max(140, p.sectors.counts.length * 34 + 40) })}
        <div class="card" style="margin-top:12px">
          <h3 class="chart-title">Sectors you've never read</h3>
          ${p.sectors.never_read.length
            ? html`<div class="never-read">${p.sectors.never_read.map((s) => html`<span class="tag">${s}</span>`)}</div>
              <p class="hint" style="margin-top:12px">Interviewers pick sectors you haven't prepared. Pick one this week.</p>`
            : html`<p class="hint">You've covered every sector. Good.</p>`}
        </div>
      </section>

      <section class="section">
        <h2 class="section-heading">Vocabulary</h2>
        <div class="grid-2">
          ${chartCard('c-vocab', 'Glossary size over time', { height: 220 })}
          ${chartCard('c-boxes', 'Leitner boxes', { height: 220 })}
        </div>
      </section>`.toString();

    // ---- Charts ----
    const t = p.trend;
    if (t.length && $('#c-trend', el)) {
      const labels = dayLabels(t.map((x) => x.date));
      const series = [['Overall', 'overall'], ['Interview', 'interview'], ['Comprehension', 'comprehension']];
      charts.push(new Chart($('#c-trend', el), {
        type: 'line',
        plugins: [endLabels],
        data: {
          labels,
          datasets: series.map(([label, key], i) => ({
            label, data: t.map((x) => x[key]),
            borderColor: SERIES[i].color, backgroundColor: SERIES[i].color, borderDash: SERIES[i].dash,
            ...(key === 'overall' ? lastPointAmber(t.length, SERIES[0].color) : {}),
          })),
        },
        options: {
          layout: { padding: { right: 96 } },
          interaction: { mode: 'index', intersect: false },
          scales: { y: { min: 0, max: 10, ticks: { stepSize: 2 } }, x: { grid: { display: false } } },
          plugins: { tooltip: { callbacks: { title: (items) => t[items[0].dataIndex].title } } },
        },
      }));
      $('#c-trend-table', el).innerHTML = html`<table class="data-table"><thead><tr><th>Date</th><th>Article</th><th>Overall</th><th>Comprehension</th><th>Interview</th></tr></thead>
        <tbody>${t.map((x) => html`<tr><td>${shortDate(x.date)}</td><td><a href="/session/${x.id}" data-link>${x.title}</a></td>
          <td>${fmtScore(x.overall)}</td><td>${fmtScore(x.comprehension)}</td><td>${fmtScore(x.interview)}</td></tr>`)}</tbody></table>`.toString();
    }

    const fw = p.frameworks.all;
    charts.push(new Chart($('#c-radar', el), {
      type: 'radar',
      data: {
        labels: fw.map((f) => f.framework),
        datasets: [{ label: 'Average score', data: fw.map((f) => f.avg), borderColor: C.ink, backgroundColor: 'rgba(24,24,27,0.08)',
          pointRadius: 3, pointBackgroundColor: C.ink, spanGaps: false }],
      },
      options: {
        plugins: { legend: { display: false }, tooltip: { callbacks: { label: (c) => ` ${c.raw ?? 'not tested'} · ${fw[c.dataIndex].n} questions` } } },
        scales: { r: { min: 0, max: 10, ticks: { stepSize: 2, backdropColor: 'transparent', color: C.light }, grid: { color: C.grid },
          angleLines: { color: C.grid }, pointLabels: { font: { size: 10 }, color: C.mid } } },
      },
    }));

    if (t.length && $('#c-clarity', el)) {
      charts.push(new Chart($('#c-clarity', el), {
        type: 'line',
        data: { labels: dayLabels(t.map((x) => x.date)), datasets: [{ label: 'Clarity', data: t.map((x) => x.clarity), borderColor: C.ink, ...lastPointAmber(t.length, C.ink) }] },
        options: { plugins: { legend: { display: false } }, scales: { y: { min: 0, max: 10, ticks: { stepSize: 5 } }, x: { grid: { display: false } } } },
      }));
    }

    const dh = p.difficulty_history;
    charts.push(new Chart($('#c-difficulty', el), {
      type: 'line',
      data: { labels: dayLabels(dh.map((x) => x.created_at)), datasets: [{ label: 'Level', data: dh.map((x) => x.level), stepped: true, borderColor: C.ink, ...lastPointAmber(dh.length, C.ink) }] },
      options: { plugins: { legend: { display: false } }, scales: { y: { min: 1, max: 10, ticks: { stepSize: 1 } }, x: { grid: { display: false } } } },
    }));

    const sc = p.sectors.counts;
    charts.push(new Chart($('#c-sectors', el), {
      type: 'bar',
      data: { labels: sc.map((s) => s.sector), datasets: [{ label: 'Articles', data: sc.map((s) => s.n), backgroundColor: C.mid, maxBarThickness: 18 }] },
      options: { indexAxis: 'y', plugins: { legend: { display: false } },
        scales: { x: { ticks: { stepSize: 1, precision: 0 } }, y: { grid: { display: false } } } },
    }));

    const vg = p.vocab.growth;
    charts.push(new Chart($('#c-vocab', el), {
      type: 'line',
      data: { labels: vg.map((v) => shortDate(v.day)), datasets: [{ label: 'Terms', data: vg.map((v) => v.total), borderColor: C.ink, stepped: true, ...lastPointAmber(vg.length, C.ink) }] },
      options: { plugins: { legend: { display: false } }, scales: { y: { beginAtZero: true, ticks: { precision: 0 } }, x: { grid: { display: false } } } },
    }));

    const bx = p.vocab.boxes;
    charts.push(new Chart($('#c-boxes', el), {
      type: 'bar',
      data: { labels: ['Box 1', 'Box 2', 'Box 3', 'Box 4', 'Box 5'], datasets: [{ label: 'Terms', data: [1, 2, 3, 4, 5].map((b) => bx[b]), backgroundColor: C.mid, maxBarThickness: 28 }] },
      options: { plugins: { legend: { display: false } }, scales: { y: { beginAtZero: true, ticks: { precision: 0 } }, x: { grid: { display: false } } } },
    }));
  }

  el.addEventListener('click', (e) => {
    const wb = e.target.closest('[data-window]');
    if (wb && wb.dataset.window !== win) {
      win = wb.dataset.window;
      try { localStorage.setItem('brj:progress-window', win); } catch { /* ignore */ }
      draw();
    }
    const tt = e.target.closest('[data-table-toggle]');
    if (tt) {
      const table = $(`#${tt.dataset.tableToggle}-table`, el);
      const wrap = $(`#${tt.dataset.tableToggle}`, el).parentElement;
      table.hidden = !table.hidden;
      wrap.hidden = !table.hidden;
      tt.textContent = table.hidden ? 'Table' : 'Chart';
    }
  });

  await draw();
  return () => { destroyCharts(); el.classList.remove('content-wide'); };
}
