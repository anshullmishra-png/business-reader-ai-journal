import { ANALYST } from '../persona.js';
import { Tags } from '../schemas.js';
import { SECTORS, COMPANY_STAGES } from '../taxonomy.js';

// Tagging only needs the gist; cap the text to keep the call fast.
const MAX_CHARS = 12000;

export function tagArticle({ title, source, text }) {
  const body = text.length > MAX_CHARS ? `${text.slice(0, MAX_CHARS)}\n[…truncated]` : text;
  return {
    task: 'tagArticle',
    tier: 'light',
    system: ANALYST,
    schema: Tags,
    prompt: `Tag this business article.

Return JSON with exactly these fields:
- companies: up to 8 company names that are named in or central to the article, most important first. Use common names ("Zepto", not "Kiranakart Technologies"). Empty array if none.
- sector: exactly one of: ${SECTORS.join(' | ')}
- business_model: one short phrase describing how the main company makes money (max 60 chars).
- company_stage: exactly one of: ${COMPANY_STAGES.join(' | ')}
- geography: the main market in a few words, e.g. "India", "India + SE Asia", "US", "Global".
- themes: 3 to 5 short business themes (2-4 words each), e.g. "Unit economics", "Customer acquisition cost", "Regulatory risk", "Consolidation".

Source: ${source}
Title: ${title}

Article:
"""
${body}
"""`,
  };
}
