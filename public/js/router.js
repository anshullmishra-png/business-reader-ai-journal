// Minimal History-API router. Each page module default-exports
//   async function render(el, params) -> optional cleanup function
import { $ } from './lib/dom.js';
import { hydrateIcons } from './lib/icons.js';
import { setActiveNav, setHeader } from './shell.js';

const routes = [
  { path: /^\/$/, load: () => import('./pages/today.js') },
  { path: /^\/session\/(?<id>\d+)$/, load: () => import('./pages/session.js') },
  { path: /^\/history$/, load: () => import('./pages/history.js') },
  { path: /^\/glossary$/, load: () => import('./pages/glossary.js') },
  { path: /^\/progress$/, load: () => import('./pages/progress.js') },
  { path: /^\/reviews$/, load: () => import('./pages/reviews.js') },
  { path: /^\/about$/, load: () => import('./pages/about.js') },
  { path: /^\/settings$/, load: () => import('./pages/settings.js') },
];

let cleanup = null;
let renderToken = 0;

export async function render() {
  const token = ++renderToken;
  const path = location.pathname.replace(/\/+$/, '') || '/';
  const match = routes.map((r) => ({ r, m: path.match(r.path) })).find((x) => x.m);
  const mod = await (match ? match.r.load() : import('./pages/notfound.js'));
  if (token !== renderToken) return; // a newer navigation won

  if (typeof cleanup === 'function') cleanup();
  cleanup = null;

  const el = $('#content');
  el.innerHTML = '';
  setHeader();
  setActiveNav(path);
  $('#main').scrollTop = 0;

  cleanup = await mod.default(el, match?.m.groups ?? {});
  hydrateIcons(el);
}

export function navigate(to, { replace = false } = {}) {
  if (to === location.pathname + location.search) return;
  history[replace ? 'replaceState' : 'pushState']({}, '', to);
  render();
}

export function initRouter() {
  document.addEventListener('click', (e) => {
    const a = e.target.closest('a[data-link]');
    if (!a || e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey) return;
    e.preventDefault();
    $('#app').dataset.dictOpen = 'false';
    navigate(a.getAttribute('href'));
  });
  window.addEventListener('popstate', render);
}
