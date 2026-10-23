// A thin ink bar across the top while a page loads or something saves.
// busy() returns a function to call when that piece of work is done.
let pending = 0;
let hideTimer = null;

export function busy() {
  const bar = document.getElementById('topbar');
  pending++;
  clearTimeout(hideTimer);
  bar?.classList.remove('done');
  bar?.classList.add('active');
  let finished = false;
  return () => {
    if (finished) return;
    finished = true;
    pending = Math.max(0, pending - 1);
    if (pending === 0 && bar) {
      bar.classList.add('done');
      hideTimer = setTimeout(() => bar.classList.remove('active', 'done'), 400);
    }
  };
}
