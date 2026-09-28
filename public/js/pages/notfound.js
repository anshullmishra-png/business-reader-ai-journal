import { html } from '../lib/dom.js';
import { setHeader } from '../shell.js';

export default async function render(el) {
  setHeader({ title: 'Not found' });
  el.innerHTML = html`
    <h1 class="page-title">Page not found</h1>
    <p class="page-lede">That page doesn't exist.</p>
    <div class="section"><a class="btn btn-primary" href="/" data-link>Go to Today</a></div>`.toString();
}
