// Chart.js (vendored) themed to the app's sapphire/gold palette. Loaded only when needed.
let loading = null;

export const C = {
  ink: '#002D72',   // sapphire
  mid: '#1E88E5',   // royal blue
  light: '#8C919B',
  faint: '#D1D5DB',
  amber: '#F9A825', // gold accent
  grid: '#ECE9E2',
  text: '#5F6878',
};

// Series are told apart by line style too, not by colour alone.
export const SERIES = [
  { color: C.ink, dash: [] },
  { color: C.mid, dash: [6, 4] },
  { color: C.light, dash: [2, 3] },
];

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
  d.font.family = "'Inter', ui-sans-serif, system-ui, sans-serif";
  d.font.size = 12;
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
    backgroundColor: C.ink,
    titleColor: '#FAFAFA',
    bodyColor: '#E4E4E7',
    padding: 10,
    cornerRadius: 8,
    boxPadding: 4,
    usePointStyle: true,
  });
  d.elements.line.borderWidth = 2;
  d.elements.line.tension = 0; // straight segments: smoothing overshoots real values
  d.elements.point.radius = 0;
  d.elements.point.hoverRadius = 5;
  d.elements.point.hitRadius = 12;
  d.elements.bar.borderRadius = 4;
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
      ctx.font = "700 11px 'Inter', system-ui, sans-serif";
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
    pointBorderColor: '#FFFFFF',
    pointBorderWidth: 2,
  };
}
