import { api } from './lib/api.js';
import { loadIcons, hydrateIcons } from './lib/icons.js';
import { initDictionary, setProfile } from './shell.js';
import { initRouter, render } from './router.js';

export const appState = { health: null, settings: null };

async function boot() {
  await loadIcons();
  hydrateIcons(document);
  initDictionary();

  const [health, settings] = await Promise.all([api('/health'), api('/settings')]);
  appState.health = health;
  appState.settings = settings;
  setProfile({ name: settings.name, demo: health.demo });

  initRouter();
  await render();
}

boot().catch((err) => {
  console.error(err);
  document.querySelector('#content').innerHTML =
    '<div class="empty"><div class="empty-title">The app could not start</div>Is the server window still open? Try restarting start.bat.</div>';
});
