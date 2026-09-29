import { api } from './lib/api.js';
import { loadIcons, hydrateIcons } from './lib/icons.js';
import { initDictionary, setProfile } from './shell.js';
import { initRouter, render } from './router.js';

export const appState = { health: null, settings: null, ai: null };

async function boot() {
  await loadIcons();
  hydrateIcons(document);
  initDictionary();

  const [health, settings, ai] = await Promise.all([api('/health'), api('/settings'), api('/ai/health')]);
  appState.health = health;
  appState.settings = settings;
  appState.ai = ai;
  setProfile({ name: settings.name, demo: health.demo });

  initRouter();
  await render();
  watchAiCheck();

  // A weekly review is written quietly if one is due. No notification.
  api('/reviews/check', { method: 'POST' }).catch(() => {});
}

// Pages don't wait for the startup AI check. If it ends in a problem,
// re-render so AI pages switch to the setup screen.
async function watchAiCheck() {
  const failed = (s) => ['not_installed', 'not_logged_in', 'error'].includes(s);
  while (appState.ai?.status === 'checking' || appState.ai?.checking) {
    await new Promise((r) => setTimeout(r, 2000));
    const before = appState.ai.status;
    appState.ai = await api('/ai/health').catch(() => appState.ai);
    if (failed(appState.ai.status) && !failed(before)) render();
  }
}

boot().catch((err) => {
  console.error(err);
  document.querySelector('#content').innerHTML =
    '<div class="empty"><div class="empty-title">The app could not start</div>Is the server window still open? Try restarting start.bat.</div>';
});
