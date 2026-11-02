// Fetches a public article URL and extracts its main text with Readability.
// Used only for the in-app "paste a link" fallback; paywalled sites (The Ken)
// go through the browser extension instead.
const MAX_BYTES = 5 * 1024 * 1024;
const TIMEOUT_MS = 20000;

export class ExtractError extends Error {
  constructor(code, message) { super(message); this.code = code; }
}

export const countWords = (text) => (String(text).match(/\S+/g) ?? []).length;

// Readability returns HTML; turn it into plain text with paragraph breaks.
function htmlToText(document, html) {
  const div = document.createElement('div');
  div.innerHTML = html;
  const blocks = div.querySelectorAll('p, h1, h2, h3, h4, h5, h6, li, blockquote, pre, figcaption');
  const parts = blocks.length
    ? [...blocks]
        .filter((el) => !el.querySelector('p, li')) // avoid duplicating nested blocks
        .map((el) => el.textContent.replace(/\s+/g, ' ').trim())
    : [div.textContent];
  return parts.filter(Boolean).join('\n\n');
}

export async function fetchArticle(url) {
  let parsed;
  try { parsed = new URL(url); } catch { throw new ExtractError('bad_url', "That doesn't look like a valid link."); }
  if (!/^https?:$/.test(parsed.protocol)) throw new ExtractError('bad_url', 'Only http and https links are supported.');

  let res;
  try {
    res = await fetch(parsed, {
      redirect: 'follow',
      signal: AbortSignal.timeout(TIMEOUT_MS),
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Safari/537.36',
        Accept: 'text/html,application/xhtml+xml',
        'Accept-Language': 'en-IN,en;q=0.9',
      },
    });
  } catch (err) {
    throw new ExtractError('fetch_failed', err.name === 'TimeoutError'
      ? 'The site took too long to respond.'
      : "Couldn't reach that site. Check the link and your connection.");
  }
  // Many publishers refuse requests from servers even for free articles.
  if ([401, 403, 429, 451].includes(res.status)) {
    throw new ExtractError('blocked', "This site doesn't allow automatic reading. Use the Send to Readout extension from the article tab, or paste the text.");
  }
  if (!res.ok) throw new ExtractError('fetch_failed', `The site returned an error (HTTP ${res.status}).`);
  if (!/html/i.test(res.headers.get('content-type') ?? '')) {
    throw new ExtractError('not_article', "That link isn't a web page.");
  }
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length > MAX_BYTES) throw new ExtractError('not_article', 'That page is too large to read.');

  // jsdom is heavy; load it only when needed.
  const [{ JSDOM, VirtualConsole }, { Readability }] = await Promise.all([import('jsdom'), import('@mozilla/readability')]);
  const dom = new JSDOM(buf.toString('utf8'), { url: res.url, virtualConsole: new VirtualConsole() });
  const doc = dom.window.document;
  const meta = (name) => doc.querySelector(`meta[property="${name}"], meta[name="${name}"]`)?.getAttribute('content')?.trim() || null;

  const article = new Readability(doc.cloneNode(true)).parse();
  const text = article?.content ? htmlToText(doc, article.content) : '';
  const result = {
    url: res.url,
    title: (meta('og:title') || article?.title || doc.title || '').trim(),
    author: article?.byline?.trim() || meta('author') || null,
    published_at: meta('article:published_time') || article?.publishedTime || null,
    text,
    word_count: countWords(text),
  };
  dom.window.close();
  return result;
}
