// Injected into the article tab (after vendor/Readability.js) by popup.js.
// Returns { url, title, author, published_at, text } from the page as the
// user sees it, logged in, so paywalled articles come through in full.
// Must be self-contained: it's serialised and run in the page.
function extractArticle() {
  const meta = (name) =>
    document.querySelector(`meta[property="${name}"], meta[name="${name}"]`)?.getAttribute('content')?.trim() || null;

  const countWords = (s) => (s.match(/\S+/g) || []).length;

  // Block-level text with paragraph breaks.
  function blocksToText(root) {
    const blocks = root.querySelectorAll('p, h2, h3, h4, li, blockquote, pre, figcaption');
    const parts = [...blocks]
      .filter((el) => !el.querySelector('p, li'))
      .map((el) => el.textContent.replace(/\s+/g, ' ').trim())
      .filter(Boolean);
    return parts.length ? parts.join('\n\n') : root.textContent.replace(/[ \t]+/g, ' ').trim();
  }

  // 1. Readability on a clone (it mutates the document it's given).
  let readabilityText = '';
  let readabilityTitle = null;
  let byline = null;
  try {
    // eslint-disable-next-line no-undef
    const parsed = new Readability(document.cloneNode(true)).parse();
    if (parsed?.content) {
      const div = document.createElement('div');
      div.innerHTML = parsed.content;
      readabilityText = blocksToText(div);
      readabilityTitle = parsed.title;
      byline = parsed.byline;
    }
  } catch (_) { /* fall back to <article> */ }

  // 2. The largest <article> element, preferred when it's substantial.
  let articleText = '';
  for (const el of document.querySelectorAll('article')) {
    const t = blocksToText(el);
    if (countWords(t) > countWords(articleText)) articleText = t;
  }

  const aw = countWords(articleText);
  const rw = countWords(readabilityText);
  // <article> can be a teaser card; use it only if it's real and not much shorter than Readability's pick.
  const text = aw >= 200 && aw >= rw * 0.6 ? articleText : (readabilityText || articleText);

  const authorLink = document.querySelector('[rel="author"]')?.textContent?.trim();
  return {
    url: location.href.split('#')[0],
    title: meta('og:title') || readabilityTitle || document.title || '',
    author: byline || meta('author') || meta('article:author') || authorLink || null,
    published_at: meta('article:published_time') ||
      document.querySelector('time[datetime]')?.getAttribute('datetime') || null,
    text,
  };
}
