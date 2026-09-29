// Comprehension word rules. public/js/lib/words.js mirrors this exactly,
// so the live counter and the server always agree.

export const MIN_WORDS = 100;
export const MAX_WORDS = 200;

// Optional template headings. They don't count toward the word limit.
export const TEMPLATE_LABELS = [
  'What happened:',
  'Why it matters:',
  'How the money works:',
  "My take (what I'd do as the founder):",
];

export function comprehensionWords(text) {
  let t = String(text ?? '');
  for (const label of TEMPLATE_LABELS) t = t.split(label).join(' ');
  return (t.match(/\S+/g) ?? []).length;
}
