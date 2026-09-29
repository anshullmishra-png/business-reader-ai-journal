// Mirrors server/services/words.js exactly: keep the two in sync.

export const MIN_WORDS = 100;
export const MAX_WORDS = 200;

export const TEMPLATE_LABELS = [
  'What happened:',
  'Why it matters:',
  'How the money works:',
  "My take (what I'd do as the founder):",
];

export const TEMPLATE_TEXT = TEMPLATE_LABELS.map((l) => `${l}\n`).join('\n');

export function comprehensionWords(text) {
  let t = String(text ?? '');
  for (const label of TEMPLATE_LABELS) t = t.split(label).join(' ');
  return (t.match(/\S+/g) ?? []).length;
}
