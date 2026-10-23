// One tooltip for the whole app. Any element with data-tip (or a title, which is
// upgraded to data-tip so the slow native tooltip never shows) gets a small mono
// label on hover or keyboard focus. data-tip-key adds a shortcut chip.
const tip = document.createElement('div');
tip.className = 'tip';
tip.setAttribute('role', 'tooltip');
tip.hidden = true;
document.body.append(tip);

let current = null;
let showTimer = null;
const DELAY_MS = 350;

function targetOf(node) {
  const el = node instanceof Element ? node.closest('[data-tip], [title]') : null;
  if (!el || el.closest('.tip')) return null;
  if (el.hasAttribute('title')) {
    if (!el.getAttribute('title')) return null;
    el.dataset.tip = el.getAttribute('title');
    el.removeAttribute('title');
  }
  return el;
}

function place(el) {
  const r = el.getBoundingClientRect();
  const t = tip.getBoundingClientRect();
  const gap = 8;
  let top = r.top - t.height - gap;
  let below = false;
  if (top < 8) { top = r.bottom + gap; below = true; }
  let left = r.left + r.width / 2 - t.width / 2;
  left = Math.max(8, Math.min(left, window.innerWidth - t.width - 8));
  tip.style.top = `${Math.round(top)}px`;
  tip.style.left = `${Math.round(left)}px`;
  tip.dataset.below = String(below);
  // Keep the little pointer over the element even when the box is nudged sideways.
  tip.style.setProperty('--arrow-x', `${Math.round(r.left + r.width / 2 - left)}px`);
}

function show(el) {
  current = el;
  tip.textContent = el.dataset.tip;
  if (el.dataset.tipKey) {
    const k = document.createElement('span');
    k.className = 'kbd';
    k.textContent = el.dataset.tipKey;
    tip.append(k);
  }
  tip.hidden = false;
  tip.classList.remove('in');
  place(el);
  requestAnimationFrame(() => tip.classList.add('in'));
}

function hide() {
  clearTimeout(showTimer);
  current = null;
  tip.hidden = true;
  tip.classList.remove('in');
}

function enter(node) {
  const el = targetOf(node);
  if (!el || el === current) return;
  clearTimeout(showTimer);
  if (current) show(el); // moving between targets: no second delay
  else showTimer = setTimeout(() => el.isConnected && show(el), DELAY_MS);
}

document.addEventListener('pointerover', (e) => { if (e.pointerType !== 'touch') enter(e.target); });
document.addEventListener('pointerout', (e) => {
  const el = targetOf(e.target);
  if (el && !el.contains(e.relatedTarget)) hide();
});
document.addEventListener('focusin', (e) => { if (e.target.matches?.(':focus-visible')) enter(e.target); });
document.addEventListener('focusout', hide);
document.addEventListener('pointerdown', hide);
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') hide(); });
window.addEventListener('scroll', hide, { passive: true, capture: true });
