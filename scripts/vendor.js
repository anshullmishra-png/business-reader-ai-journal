// Copies third-party browser assets from node_modules into /public/vendor.
// The output is committed, so the app works offline without running this.
// Run `npm run vendor` after upgrading chart.js or lucide-static.
import { copyFileSync, mkdirSync, existsSync, writeFileSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const nm = join(root, 'node_modules');
const vendor = join(root, 'public', 'vendor');

// Icons used across the UI. Add names here, then re-run.
export const ICONS = [
  'sun', 'history', 'book-a', 'chart-line', 'notebook-pen', 'info', 'settings',
  'download', 'search', 'x', 'check', 'lock', 'clock', 'arrow-right', 'plus',
  'link', 'file-text', 'refresh-cw', 'chevron-right', 'external-link',
  'trash-2', 'upload', 'shield-check', 'triangle-alert', 'panel-right',
  'circle-check', 'loader-circle', 'puzzle', 'copy', 'terminal', 'square-check',
  'square', 'target', 'layers', 'log-out', 'user', 'chevron-down', 'flame', 'gauge', 'calendar', 'arrow-up-right', 'mail', 'key-round',
];

function copy(from, to) {
  mkdirSync(dirname(to), { recursive: true });
  copyFileSync(from, to);
}

copy(join(nm, 'chart.js', 'dist', 'chart.umd.min.js'), join(vendor, 'chart.js', 'chart.umd.min.js'));
copy(join(nm, 'chart.js', 'LICENSE.md'), join(vendor, 'chart.js', 'LICENSE.md'));

// Lucide: bundle the chosen SVGs into one JSON map, so the client loads them in one request.
const iconDir = join(nm, 'lucide-static', 'icons');
const map = {};
for (const name of ICONS) {
  const file = join(iconDir, `${name}.svg`);
  if (!existsSync(file)) { console.warn(`[vendor] missing icon: ${name}`); continue; }
  map[name] = readFileSync(file, 'utf8')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/\s*class="[^"]*"/, '')
    .replace(/\n\s*/g, ' ')
    .trim();
}
mkdirSync(join(vendor, 'lucide'), { recursive: true });
writeFileSync(join(vendor, 'lucide', 'icons.json'), JSON.stringify(map));
copy(join(nm, 'lucide-static', 'LICENSE'), join(vendor, 'lucide', 'LICENSE'));

console.log(`[vendor] chart.js + ${Object.keys(map).length}/${ICONS.length} icons -> public/vendor`);
