import { ANALYST } from '../persona.js';
import { RelatedReading } from '../schemas.js';
import { RELATED_CATEGORIES } from '../taxonomy.js';

const MAX_ARTICLE_CHARS = 15000;

export function relatedReading({ title, source, text }) {
  const body = text.length > MAX_ARTICLE_CHARS ? `${text.slice(0, MAX_ARTICLE_CHARS)}\n[…truncated]` : text;
  return {
    task: 'relatedReading',
    tier: 'strong',
    system: ANALYST,
    schema: RelatedReading,
    prompt: `A Chief of Staff candidate has just read the article below. Suggest 3 to 5 topics they should explore next to understand it deeply enough to discuss it in an interview.

For each topic return:
- title: the topic, specific to this article (max 90 chars). Not generic: "How Moneyview's NBFC arm changes its take rate", not "Fintech lending".
- category: exactly one of: ${RELATED_CATEGORIES.join(' | ')}
- why: one line (max 200 chars) on what this adds to understanding THIS article.
- queries: 1 or 2 Google search queries that would surface good reading on the topic. Include company names, people or years so results are specific.

Rules:
- Use at least 3 different categories.
- NEVER write URLs, domain names or links anywhere. Only plain search text. The app turns queries into Google search links itself.
- Don't suggest re-reading the article itself.

Source: ${source}
Title: ${title}

Article:
"""
${body}
"""`,
  };
}
