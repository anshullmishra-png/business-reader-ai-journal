/* global extractArticle */
const view = document.getElementById('view');

const DEFAULT_SERVER = 'http://127.0.0.1:4317';

function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'onclick') node.addEventListener('click', v);
    else node.setAttribute(k, v);
  }
  node.append(...children);
  return node;
}

function show(...nodes) {
  view.replaceChildren(...nodes);
}

const openOptions = () => chrome.runtime.openOptionsPage();

async function settings() {
  const { server = DEFAULT_SERVER, token = '' } = await chrome.storage.local.get(['server', 'token']);
  return { server: server.replace(/\/+$/, ''), token };
}

async function readPage(tabId) {
  await chrome.scripting.executeScript({ target: { tabId }, files: ['vendor/Readability.js'] });
  const [{ result }] = await chrome.scripting.executeScript({ target: { tabId }, func: extractArticle });
  return result;
}

const words = (s) => (s.match(/\S+/g) || []).length;

async function send(article, { server, token }) {
  let res;
  try {
    res = await fetch(`${server}/api/capture`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Capture-Token': token },
      body: JSON.stringify(article),
    });
  } catch {
    throw new Error("Couldn't reach the journal. Is it running? Double-click start.bat, then try again.");
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `The journal returned an error (${res.status}).`);
  return data;
}

async function main() {
  const conf = await settings();
  if (!conf.token) {
    show(
      el('p', { class: 'muted' }, 'Paste your capture token first. Find it in the journal: Settings → Browser extension.'),
      el('button', { class: 'btn', onclick: openOptions }, 'Open extension settings'),
    );
    return;
  }

  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id || !/^https?:/.test(tab.url || '')) {
    show(el('p', { class: 'muted' }, 'Open an article in this tab first.'));
    return;
  }

  let article;
  try {
    article = await readPage(tab.id);
  } catch (err) {
    show(el('p', { class: 'error' }, "This page can't be read. " + (err.message || '')));
    return;
  }

  const count = words(article.text || '');
  const sendBtn = el('button', { class: 'btn' }, 'Send to Journal');
  show(
    el('p', { class: 'title' }, article.title || 'Untitled page'),
    el('div', { class: 'meta' }, `${count.toLocaleString()} words found`),
    count < 300
      ? el('p', { class: 'error' }, 'That looks short. If this is a paywalled article, make sure you are logged in and the full text is showing.')
      : '',
    sendBtn,
  );

  sendBtn.addEventListener('click', async () => {
    sendBtn.disabled = true;
    sendBtn.textContent = 'Sending…';
    try {
      const out = await send(article, conf);
      show(
        el('p', { class: 'ok' }, out.existing ? 'Already in today’s journal ✓' : 'Sent ✓'),
        el('button', { class: 'btn', onclick: () => chrome.tabs.create({ url: out.open_url }) }, 'Open journal'),
      );
    } catch (err) {
      show(
        el('p', { class: 'error' }, err.message),
        el('button', { class: 'btn btn-ghost', onclick: main }, 'Try again'),
        el('p', { class: 'small' }, el('a', { href: '#', onclick: (e) => { e.preventDefault(); openOptions(); } }, 'Extension settings')),
      );
    }
  });
}

main();
