# evzero.org

Personal site and project hub of Ritvik (evzero), v3.1.

Pure HTML / CSS / vanilla JS: drop it anywhere that serves static files.

## Pages

| URL                  | Source                  |
|----------------------|-------------------------|
| `evzero.org`         | `index.html`            |
| `/projects`          | `projects/index.html`   |
| `/contact`           | `contact/index.html`    |
| `/watchparty`        | `watchparty/index.html` |
| `/valorant`          | `valorant/index.html`   |
| `/spice`             | `spice/index.html`      |
| `/ais`               | `ais/index.html`        |
| `/qres`              | `qres/index.html`       |
| `/resume`            | `resume/index.html`     |
| `/sketch`            | `sketch/` (built, see below) |
| anything else        | `404.html`              |

## File layout

```
website-evzero/
├── index.html              ← home: wordmark pill + cube, profile, headliners, slab shelf
├── projects/index.html     ← sticker picker + index rows + case file
├── contact/index.html      ← discord + email
├── watchparty/index.html   ← room, player, extension
├── valorant/index.html     ← tracker (marked outdated)
├── ais/ spice/ qres/       ← product pages (share css/product.css)
├── resume/index.html       ← one-page CV, "Save as PDF" prints just the sheet
├── 404.html
├── css/
│   ├── site.css            ← tokens, curtain + welcome, top bar, sticker menu, chapter dock,
│   │                         panels, reveals, buttons, glow cards, footer, cat, cursor
│   ├── home.css  projects.css  contact.css  watchparty.css  valorant.css
│   ├── product.css         ← /ais, /spice, /qres + their app mock-ups
│   ├── resume.css          ← résumé sheet + its print layout
│   └── common.css          ← frozen v2 sheet, only the sealed page still links it
├── js/
│   ├── site.js             ← curtain, smooth scroll, cursor, menu, command palette, dock,
│   │                         stickers, warp field, panels, scroll motion, sound, build log
│   ├── cat.js              ← pixel cat state machine
│   ├── projects.js         ← project copy + the case-file viewer
│   ├── watchparty.js  player-web.js  valorant.js
│   ├── common.js           ← frozen v2 script, only the sealed page still links it
│   └── vendor/lenis.min.js ← smooth scrolling (Lenis 1.3.26, MIT)
├── tools/
│   ├── seal.mjs            ← encrypts a sealed page's contents (see Notes)
│   └── serve.py            ← local preview server: no caching, 404.html for unknown paths
├── assets/
│   ├── favicon.png         ← the tab icon every page links to
│   ├── og*.png             ← link-preview images (1200×630) for Discord, LinkedIn, X
│   └── ais-review.webp     ← screenshot on the AiS page
├── api/                    ← clipped licence server: handlers (api/clipped) + shared code (api/_lib)
├── workers/clipped-api/    ← runs that server on Cloudflare Workers (see its README)
├── clipped/api.json        ← where the clipped app and pages find the licence server
├── CNAME                   ← GitHub Pages custom domain
├── _redirects              ← Netlify clean-URL redirects
├── vercel.json             ← Vercel clean-URL config
└── README.md
```

## Project pages

`/spice` and `/ais` are landing pages only; the applications themselves live in
their own repositories:

| Page    | Source repo                                   |
|---------|-----------------------------------------------|
| `/spice`| <https://github.com/ritviksajeev/spice>       |
| `/ais`  | <https://github.com/ritviksajeev/ais>         |

Each keeps a `latest.json` next to its page with the current version, so the
page and the release can be kept in step without editing markup.

## Sketch Fighter

`sketch-fighter/` is the source of a separate app (Flask + Phaser). `sketch/` is
its static web build, served at `/sketch/`; regenerate it with
`npm run build:web` in `sketch-fighter/frontend` (never edit `sketch/` by hand).
See `sketch-fighter/README.md`.

## Notes & TODOs

- Look: ink black, warm off-white type, one iris accent (tokens at the top of
  `css/site.css`). Fonts are Geist, Geist Mono and Instrument Serif (the
  italic accent phrase in big titles is `.accent`).
- Every public page shares the same head, top bar and footer markup. Change
  one, change them all.
- Projects: each one is a row in `projects/index.html` (status and version
  live there as `data-status` / `data-kind` / `data-version`) plus an entry in
  `PROJECTS` in `js/projects.js` (the prose, files and buttons). The stickers
  are drawn by `STICKERS` in `js/site.js`; put one anywhere with
  `<span data-sticker="ais"></span>`.
- Preview locally with `python tools/serve.py` (port 8765). It sends
  no-cache headers so a normal reload always shows your latest edit, and
  serves `404.html` for missing pages like GitHub Pages does.
- Command palette: Ctrl/Cmd + K or the search button in the top bar. Its
  entries are the `ITEMS` list in `initPalette` in `js/site.js`.
- Sound: off by default, toggled from the top bar and remembered per visitor.
  Every sound is synthesised in `SFX` in `js/site.js`; there are no audio files.
- Build log: the homepage pulls the latest public commits from GitHub
  (`REPOS` in `initBuildLog`), two per repo, cached 20 minutes per visitor.
- Link previews: every page carries Open Graph / Twitter tags pointing at
  `assets/og.png` (AiS, Spice and Qres have their own).
- The menu and the chapter dock are built by `site.js`: the menu from
  `MENU_PAGES` / `MENU_PROJECTS`, the dock from every `data-chapter="Name"`
  section on the page.
- CSS/JS links carry a `?v=` cache-buster. After editing a stylesheet or
  script, bump the number on every link to that file so visitors don't get a
  stale cached copy next to new HTML.
- Motion hooks (in `site.js` / `site.css`): `data-split` (letter blur-in),
  `data-lit` (words light up on scroll), `.reveal` + `d1`–`d7` (rise + unblur;
  `.glow` cards tip up), `data-scrub` (slide / rise / zoom / depth with scroll),
  `.line-mask > .line` + `.intro-fade` (play when the curtain lifts),
  `data-warp` (star field), `.glow` (border lights up near the cursor),
  `data-count`, `data-flip`, `data-scramble`, `data-marquee`,
  `data-magnetic`, `data-cursor-label="View"`.
- Page curtain: every page has a `.loader` that shows the `evzero` mark while
  it loads and sweeps in on page changes. The first homepage view of a
  session (sessionStorage `evz-welcomed`) plays `evzero` -> `WELCOME` on it
  before lifting; the welcome markup lives only in `index.html`.
- Sealed pages: a page can ship as just a password gate plus one encrypted
  blob (`<script id="seal">`). Everything behind the gate (markup, styles,
  script) is AES-GCM encrypted with a PBKDF2 key from the password, which is
  never stored anywhere. Edit one by opening it, changing the files, and
  sealing it again:
  `node tools/seal.mjs open <page>/index.html .private/<page>` then
  `node tools/seal.mjs seal .private/<page> <page>/index.html`.
  `.private/` is git-ignored: never commit the opened files.
- Page-to-page scrolling: each page's `<main class="page panel-group">` and
  `<footer class="site-footer panel">` sit inside `<div class="panels">`, and
  every top-level `<section>` in main has the `panel` class. Panels pin once
  their bottom reaches the screen bottom and the next one slides over them.
  Keep `position: fixed` things (the case file, toasts) *outside* `.panels`.

---

© EvZero. Built from zero.
