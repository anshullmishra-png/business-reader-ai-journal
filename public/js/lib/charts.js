// Chart.js (vendored) themed to the app's sapphire/gold palette. Loaded only when needed.
let loading = null;

export const C = {
  ink: '#FEDEE1',                     // pale pink: the only light
  mid: 'rgba(254, 222, 225, 0.62)',
  light: 'rgba(254, 222, 225, 0.42)',
  faint: 'rgba(254, 222, 225, 0.2)',
  amber: '#0A0708',                   // black marks the latest point
  grid: 'rgba(254, 222, 225, 0.14)',
  text: 'rgba(254, 222, 225, 0.62)',
  fill: 'rgba(254, 222, 225, 0.12)',
  tipBg: '#0A0708',
  tipFg: '#FEDEE1',
};

// One hue, so series are told apart by line style as well as value.
export const SERIES = [
  { color: C.ink, dash: [] },
  { color: C.mid, dash: [6, 4] },
  { color: C.light, dash: [2, 3] },
];

/** Printed reports are oxblood ink on white paper. Call before loadChart(). */
export function usePrintPalette() {
  Object.assign(C, {
    ink: '#70020F', mid: 'rgba(112, 2, 15, 0.62)', light: 'rgba(112, 2, 15, 0.4)', faint: 'rgba(112, 2, 15, 0.18)',
    amber: '#0A0708', grid: 'rgba(112, 2, 15, 0.12)', text: 'rgba(112, 2, 15, 0.7)', fill: 'rgba(112, 2, 15, 0.08)',
  });
  SERIES[0].color = C.ink; SERIES[1].color = C.mid; SERIES[2].color = C.light;
}

export function loadChart() {
  loading ??= new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = '/vendor/chart.js/chart.umd.min.js';
    s.onload = () => { applyTheme(window.Chart); resolve(window.Chart); };
    s.onerror = reject;
    document.head.append(s);
  });
  return loading;
}

function applyTheme(Chart) {
  const d = Chart.defaults;
  d.font.family = "'IBM Plex Mono', ui-monospace, monospace";
  d.font.size = 11;
  d.color = C.text;
  d.borderColor = C.grid;
  d.animation = { duration: 250 };
  d.maintainAspectRatio = false;
  d.plugins.legend.labels.usePointStyle = true;
  d.plugins.legend.labels.boxWidth = 8;
  d.plugins.legend.labels.boxHeight = 8;
  d.plugins.legend.labels.color = C.mid;
  d.plugins.legend.align = 'start';
  Object.assign(d.plugins.tooltip, {
    backgroundColor: C.tipBg ?? C.ink,
    titleColor: C.tipFg ?? '#FFFFFF',
    bodyColor: C.tipFg ?? '#FFFFFF',
    padding: 10,
    cornerRadius: 0,
    boxPadding: 4,
    usePointStyle: true,
  });
  d.elements.line.borderWidth = 2;
  d.elements.line.tension = 0; // straight segments: smoothing overshoots real values
  d.elements.point.radius = 0;
  d.elements.point.hoverRadius = 5;
  d.elements.point.hitRadius = 12;
  d.elements.bar.borderRadius = 0;
  d.scale.grid.drawTicks = false;
  d.scale.border = { display: false };
  d.scale.ticks.padding = 8;
}

/**
 * X-axis labels from ISO dates; repeated days get a counter ("29 Sept · 2")
 * so several sessions on one day stay distinguishable.
 */
export function dayLabels(isos) {
  const seen = {};
  return isos.map((iso) => {
    const d = new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
    seen[d] = (seen[d] ?? 0) + 1;
    return seen[d] > 1 ? `${d} · ${seen[d]}` : d;
  });
}

// Direct labels at the end of each line, so identity never rests on shade alone.
export const endLabels = {
  id: 'endLabels',
  afterDatasetsDraw(chart) {
    const { ctx } = chart;
    const placed = [];
    chart.data.datasets.forEach((ds, i) => {
      const meta = chart.getDatasetMeta(i);
      if (meta.hidden) return;
      const pt = [...meta.data].reverse().find((p) => !p.skip);
      if (!pt) return;
      let y = pt.y;
      while (placed.some((p) => Math.abs(p - y) < 13)) y += 13; // avoid overlaps
      placed.push(y);
      ctx.save();
      ctx.font = "500 10px 'IBM Plex Mono', monospace";
      ctx.fillStyle = C.mid;
      ctx.textBaseline = 'middle';
      ctx.fillText(ds.label, pt.x + 10, y);
      ctx.restore();
    });
  },
};

/** A line series whose last point is highlighted in amber. */
export function lastPointAmber(n, color) {
  return {
    pointRadius: (ctx) => (ctx.dataIndex === n - 1 ? 5 : 0),
    pointBackgroundColor: (ctx) => (ctx.dataIndex === n - 1 ? C.amber : color),
    pointBorderColor: C.ink,
    pointBorderWidth: 2,
  };
}
