# Fonts

The app uses **Satoshi** (UI) and **Zodiak** (long-form text) by Indian Type Foundry, from [Fontshare](https://www.fontshare.com).

They're free to use and self-host in your own apps under the ITF Free Font License (FFL), but the license doesn't allow redistributing the font files through a repository. So they're not committed here.

`start.bat` and `npm start` run `scripts/fetch-fonts.js`, which downloads your own copy from Fontshare into this folder on first launch. If the download fails, the app falls back to system fonts.

- Satoshi: https://www.fontshare.com/fonts/satoshi
- Zodiak: https://www.fontshare.com/fonts/zodiak
- License: https://www.fontshare.com/licenses/itf-ffl
