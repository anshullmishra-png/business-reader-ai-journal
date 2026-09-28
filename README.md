# Business Reads Journal

A local-first journal that turns daily business reading into deliberate practice for Chief of Staff and Founder's Office interviews.

> Work in progress. The full README (screenshots, architecture, setup guide) comes with the final build phase. The spec is in [docs/build-prompt.md](docs/build-prompt.md).

## Run it (Windows)

1. Install [Node.js](https://nodejs.org) (LTS).
2. Double-click `start.bat`. On first launch it installs dependencies and downloads the fonts, then opens the app at http://127.0.0.1:4317.

Or from a terminal:

```
npm install
npm start
```

All data stays on your laptop in `data/journal.db`, which is never committed.
