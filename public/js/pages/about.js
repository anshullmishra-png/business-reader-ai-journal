import { html } from '../lib/dom.js';
import { setHeader } from '../shell.js';

export default async function render(el) {
  setHeader({ title: 'About' });
  el.innerHTML = html`
    <div class="label page-kicker">About</div>
    <h1 class="page-title">About this journal</h1>
    <p class="page-lede">Daily business reading, turned into deliberate practice for business, strategy and consulting interviews.</p>

    <section class="section prose">
      <p>Reading The Ken or The Arc every morning feels productive. But reading isn't the same as being able to explain the
        business, size the market, or defend a view under pressure in an interview. This journal closes that gap.</p>
    </section>

    <section class="section">
      <h2 class="section-heading">The daily loop</h2>
      <div class="card prose">
        <p><strong>Add.</strong> Read an article on the original site and send it to the journal with one click.</p>
        <p><strong>Write.</strong> Condense it into 100–200 words: what happened, why it matters, how the money works, and your take.</p>
        <p><strong>Explore.</strong> Follow 3–5 suggested threads: competitors, the sector, the founders, the core concept.</p>
        <p><strong>Interview.</strong> Ten timed questions, one at a time, with no going back: MCQs, estimation, structured breakdowns.</p>
        <p><strong>Verdict.</strong> A blunt score out of 10, a model answer for every question, and two things to work on next.</p>
      </div>
    </section>

    <section class="section">
      <h2 class="section-heading">Why a tough interviewer</h2>
      <div class="prose">
        <p>The evaluator is modelled on a demanding senior interviewer: short sentences, no compliments unless earned.
          It calls out vague thinking, missing numbers and lists that aren't MECE. A 5 means acceptable for a first round;
          an 8 needs real numbers, clear structure and a non-obvious insight. Generous feedback feels good. Honest feedback
          is what actually prepares you.</p>
      </div>
    </section>

    <section class="section">
      <h2 class="section-heading">How it works</h2>
      <div class="prose">
        <p>The journal is a small web app: a Node.js server on Vercel, a Turso (SQLite) database, and plain HTML, CSS and JavaScript.
          The interviewer and evaluator run on Google Gemini. Every AI response is checked against a strict schema before it's saved.</p>
        <p>Each reader has a private account; nobody else can see your writing or scores. The app never logs in anywhere or scrapes
          paywalled sites on its own: those articles come from your own browser tab through a small extension.
          Article text is used only to ground the questions and the evaluation.</p>
      </div>
    </section>`.toString();
}
