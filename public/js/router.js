// Minimal History-API router. Each page module default-exports
//   async function render(el, params) -> optional cleanup function
import { $ } from './lib/dom.js';
import { hydrateIcons } from './lib/icons.js';
import { setActiveNav, setHeader, showChrome } from './shell.js';
import { appState } from './app.js';
import { busy } from './lib/topbar.js';

// public: reachable while signed out (sign-in pages). Everything else needs an account.
const routes = [
  { path: /^\/signin$/, load: () => import('./pages/auth.js'), public: true },
  { path: /^\/signup$/, load: () => import('./pages/auth.js'), public: true },
  { path: /^\/$/, load: () => import('./pages/today.js') },
  { path: /^\/session\/(?<id>\d+)$/, load: () => import('./pages/session.js') },
  { path: /^\/history$/, load: () => import('./pages/history.js') },
  { path: /^\/glossary$/, load: () => import('./pages/glossary.js') },
  { path: /^\/progress$/, load: () => import('./pages/progress.js') },
  { path: /^\/reviews$/, load: () => import('./pages/reviews.js') },
  { path: /^\/about$/, load: () => import('./pages/about.js') },
  { path: /^\/settings$/, load: () => import('./pages/settings.js') },
  { path: /^\/extension$/, load: () => import('./pages/extension.js') },
];

let cleanup = null;
let renderToken = 0;

export async function render() {
  const token = ++renderToken;
  const path = location.pathname.replace(/\/+$/, '') || '/';
  const match = routes.map((r) => ({ r, m: path.match(r.path) })).find((x) => x.m);

  // Signed out → sign in (remembering where they were going); signed in → skip the auth pages.
  if (!appState.user && !match?.r.public) {
    const next = path === '/' ? '' : `?next=${encodeURIComponent(path)}`;
    return navigate(`/signin${next}`, { replace: true });
  }
  if (appState.user && match?.r.public) return navigate('/', { replace: true });

  const done = busy();
  const mod = await (match ? match.r.load() : import('./pages/notfound.js'));
  if (token !== renderToken) { done(); return; } // a newer navigation won

  if (typeof cleanup === 'function') cleanup();
  cleanup = null;

  showChrome(Boolean(appState.user));
  const el = $('#content');
  el.innerHTML = '';
  // One quick fade per page, started before anything is drawn (so it can't flash).
  el.classList.remove('page-in');
  void el.offsetWidth;
  el.classList.add('page-in');
  setHeader();
  setActiveNav(path);
  window.scrollTo(0, 0);

  try {
    cleanup = await mod.default(el, match?.m.groups ?? {}, { onReady: render });
  } finally {
    done();
  }
  hydrateIcons(el);
}

export function navigate(to, { replace = false } = {}) {
  if (to !== location.pathname + location.search) history[replace ? 'replaceState' : 'pushState']({}, '', to);
  return render();
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
