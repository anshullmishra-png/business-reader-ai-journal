// Fixed vocabularies, so analytics (sector coverage, framework strength) aggregate cleanly.

export const SECTORS = [
  'Fintech',
  'Banking & Insurance',
  'E-commerce & Quick commerce',
  'Consumer brands & D2C',
  'Retail',
  'Food & Beverage',
  'SaaS & Enterprise tech',
  'AI & Deep tech',
  'Edtech',
  'Healthtech & Pharma',
  'Mobility & EV',
  'Logistics & Supply chain',
  'Media & Entertainment',
  'Gaming',
  'Travel & Hospitality',
  'Real estate & Proptech',
  'Energy & Climate',
  'Manufacturing & Industrials',
  'Telecom',
  'Agritech',
  'Policy & Regulation',
  'Macroeconomy & Markets',
  'Other',
];

export const COMPANY_STAGES = [
  'Early-stage startup',
  'Growth-stage startup',
  'Late-stage / pre-IPO',
  'Listed company',
  'Conglomerate / group',
  'Government / public sector',
  'Multiple / industry-wide',
];

export const SOURCES = {
  the_ken: 'The Ken',
  the_arc: 'The Arc',
  entrackr: 'Entrackr',
  other: 'Other',
};

export function detectSource(url) {
  let host = '';
  try { host = new URL(url).hostname.toLowerCase().replace(/^www\./, ''); } catch { return 'other'; }
  if (host === 'the-ken.com' || host.endsWith('.the-ken.com')) return 'the_ken';
  if (host === 'thearcweb.com' || host.endsWith('.thearcweb.com')) return 'the_arc';
  if (host === 'entrackr.com' || host.endsWith('.entrackr.com')) return 'entrackr';
  return 'other';
}
