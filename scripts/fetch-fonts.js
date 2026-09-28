// Downloads Satoshi and Zodiak from Fontshare into /public/fonts.
// The ITF Free Font License allows self-hosting for your own apps but forbids
// redistributing the files through a repository, so they are gitignored and
// every install fetches its own copy from Fontshare. Safe to run repeatedly.
import { mkdirSync, existsSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const outDir = join(root, 'public', 'fonts');

// Must match the @font-face rules in public/css/fonts.css.
const WANTED = [
  ['Satoshi', 400], ['Satoshi', 700], ['Satoshi', 900],
  ['Zodiak', 400], ['Zodiak', 900],
];
// Fontshare returns only the first family per request, so ask once per family.
const CSS_URLS = [
  'https://api.fontshare.com/v2/css?f[]=satoshi@400,700,900&display=swap',
  'https://api.fontshare.com/v2/css?f[]=zodiak@400,900&display=swap',
];

const fileFor = (family, weight) => join(outDir, `${family}-${weight}.woff2`);

export async function fetchFonts({ quiet = false } = {}) {
  const log = (...a) => { if (!quiet) console.log(...a); };
  if (WANTED.every(([f, w]) => existsSync(fileFor(f, w)))) {
    log('[fonts] already present');
    return true;
  }
  mkdirSync(outDir, { recursive: true });
  try {
    const css = (await Promise.all(CSS_URLS.map(async (u) => (await fetch(u)).text()))).join('\n');
    const faces = [...css.matchAll(/@font-face\s*{([^}]*)}/g)].map((m) => m[1]);
    for (const [family, weight] of WANTED) {
      const face = faces.find((f) =>
        f.includes(`'${family}'`) && f.match(/font-weight:\s*(\d+)/)?.[1] === String(weight) && /font-style:\s*normal/.test(f));
      const url = face?.match(/url\('([^']+\.woff2)'\)/)?.[1];
      if (!url) throw new Error(`no woff2 for ${family} ${weight}`);
      const res = await fetch(url.startsWith('//') ? `https:${url}` : url);
      if (!res.ok) throw new Error(`${family} ${weight}: HTTP ${res.status}`);
      writeFileSync(fileFor(family, weight), Buffer.from(await res.arrayBuffer()));
      log(`[fonts] ${family} ${weight}`);
    }
    return true;
  } catch (err) {
    console.warn(`[fonts] could not download fonts (${err.message}). The app will use system fonts.`);
    return false;
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const ok = await fetchFonts();
  process.exitCode = ok ? 0 : 1;
}
