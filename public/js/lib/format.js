export const SOURCE_LABELS = { the_ken: 'The Ken', the_arc: 'The Arc', entrackr: 'Entrackr', other: 'Other' };

export const STAGE_LABELS = {
  write: 'Write',
  explore: 'Explore',
  interview: 'Interview',
  verdict: 'Done',
};

export const fmtTime = (iso) =>
  new Date(iso).toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' });

export const fmtDate = (iso) =>
  new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });

// Published dates from sites come in many shapes; show them only if they parse.
export function fmtMaybeDate(s) {
  if (!s) return null;
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : fmtDate(d.toISOString());
}

export const fmtScore = (n) => (n == null ? '—' : Number(n).toFixed(1));

export const plural = (n, word) => `${n.toLocaleString()} ${word}${n === 1 ? '' : 's'}`;
