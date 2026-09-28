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
}

boot().catch((err) => {
  console.error(err);
  document.querySelector('#content').innerHTML =
    '<div class="empty"><div class="empty-title">The app could not start</div>Is the server window still open? Try restarting start.bat.</div>';
});
