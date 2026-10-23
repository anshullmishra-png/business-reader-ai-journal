import { api } from './lib/api.js';
import { loadIcons, hydrateIcons } from './lib/icons.js';
import { initDictionary, initProfileMenu, setProfile } from './shell.js';
import { initRouter, render } from './router.js';

// user: the signed-in reader (null when signed out). ai: { configured, calls_today, daily_limit }.
export const appState = { user: null, ai: null };

/** Reloads the signed-in user (after sign-in or a settings change). */
export async function loadMe() {
  try {
    const { ai, ...user } = await api('/me');
    appState.user = user;
    appState.ai = ai;
    setProfile(user);
  } catch (err) {
    if (err.status !== 401) throw err;
    appState.user = null;
    appState.ai = null;
  }
  return appState.user;
}

async function boot() {
  await loadIcons();
  hydrateIcons(document);
  initDictionary();
  initProfileMenu();
  await loadMe();
  initRouter();
  await render();

  // A weekly review is written quietly if one is due. No notification.
  if (appState.user) api('/reviews/check', { method: 'POST' }).catch(() => {});
}

boot().catch((err) => {
  console.error(err);
  document.querySelector('#content').innerHTML =
    '<div class="empty"><div class="empty-title">The app could not start</div>Check your connection and refresh the page.</div>';
});
