// Lucide icons, vendored as one JSON map (see scripts/vendor.js).
let icons = {};

export async function loadIcons() {
  icons = await (await fetch('/vendor/lucide/icons.json')).json();
}

export function icon(name, cls = '') {
  const svg = icons[name] ?? '';
  return `<span class="icon ${cls}" aria-hidden="true">${svg}</span>`;
}

// Replaces every <span data-icon="name"> under root with the inline SVG.
export function hydrateIcons(root = document) {
  for (const el of root.querySelectorAll('[data-icon]')) {
    const name = el.getAttribute('data-icon');
    el.removeAttribute('data-icon');
    if (el.classList.contains('brand-mark')) {
      el.innerHTML = icon(name);
    } else {
      el.outerHTML = icon(name);
    }
  }
}
