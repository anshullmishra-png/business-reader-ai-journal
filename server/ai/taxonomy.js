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

export const RELATED_CATEGORIES = [
  'Company background',
  'Competitor landscape',
  'Sector explainer',
  'Founders',
  'Funding history',
  'Core concept',
];

export const QUESTION_TYPES =['mcq', 'short', 'structured', 'estimation'];

// Every interview question is tagged with exactly one of these.
export const FRAMEWORKS = [
  'First principles',
  'MECE',
  'Issue trees',
  "Porter's Five Forces",
  'Unit economics',
  'Jobs-to-be-Done',
  'Second-order thinking',
  'SWOT',
  'Moats',
  '2x2 matrices',
  'Value chain',
  'Market sizing',
  'Pricing strategy',
  'Business model canvas',
  'Network effects',
  '80/20',
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
