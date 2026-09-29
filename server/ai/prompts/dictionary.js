import { ANALYST } from '../persona.js';
import { TermEntry, MoreExamples, GLOSSARY_SECTORS } from '../schemas.js';

export function defineTerm({ term }) {
  return {
    task: 'defineTerm',
    tier: 'light',
    system: ANALYST,
    schema: TermEntry,
    prompt: `Define this term for a student preparing for Chief of Staff interviews: "${term}"

Return:
- is_business_term: true if it's a business, finance, strategy, economics or startup term (acronyms like CAC, GMV, EBITDA count). If false, fill the other fields minimally (empty arrays, null formula).
- display_term: the standard written form, expanding acronyms, e.g. "Gross merchandise value (GMV)".
- definition: plain English, 2-3 sentences. No jargon you don't explain.
- formula: the formula if there is a standard one, else null.
- examples: exactly 3, each naming a real company and showing the term in action in 1-2 sentences. Mix Indian companies (e.g. Zomato, Zepto, Nykaa, Paytm, Reliance, HDFC Bank) and global ones. Use only facts you are confident about; if unsure of a figure, describe it qualitatively.
- why_it_matters: why a Chief of Staff or founder's office hire should care, 1-2 sentences.
- related: exactly 3 closely related terms.
- sector: one of: ${GLOSSARY_SECTORS.join(' | ')}`,
  };
}

export function moreExamples({ term, existing }) {
  return {
    task: 'moreExamples',
    tier: 'light',
    system: ANALYST,
    schema: MoreExamples,
    prompt: `Give 3 more real-company examples of the business term "${term}".
Each: the company, and 1-2 sentences showing the term in action. Mix Indian and global companies.
Do not reuse these companies: ${existing.join(', ') || 'none'}.
Use only facts you are confident about; if unsure of a figure, describe it qualitatively.`,
  };
}
