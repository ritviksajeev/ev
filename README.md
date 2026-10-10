# evzero.org

Personal site + Solren esports hub.

Pure HTML / CSS / vanilla JS — drop anywhere that serves static files.

## Pages

| URL                  | Source                  |
|----------------------|-------------------------|
| `evzero.org`         | `index.html`            |
| `/projects`          | `projects/index.html`   |
| `/solren`            | `solren/index.html`     |
| `/contact`           | `contact/index.html`    |
| `/watchparty`        | `watchparty/index.html` |
| `/valorant`          | `valorant/index.html`   |
| `/spice`             | `spice/index.html`      |
| `/ais`               | `ais/index.html`        |
| `/qres`              | `qres/index.html`       |
| `/sketch`            | `sketch/` (built, see below) |

## File layout

```
website-evzero/
├── index.html              ← home page
├── projects/index.html     ← shop-style project grid + modal
├── solren/index.html       ← esports team, tabbed by game
├── contact/index.html      ← discord + email
├── qres/index.html     ← Qres landing page
├── css/
│   ├── common.css          ← theme, nav + menu, curtain + welcome, reveals, footer, cat, cursor
│   ├── home.css
│   ├── projects.css
│   ├── solren.css
│   ├── qres.css
│   └── contact.css
├── js/
│   ├── common.js           ← page curtain + homepage welcome, smooth scroll, cursor, menu, reveals
│   ├── cat.js              ← pixel cat state machine
│   ├── projects.js         ← project modal + SVG covers
│   ├── solren.js           ← game tab switcher
│   └── vendor/lenis.min.js ← smooth scrolling (Lenis 1.3.26, MIT)
├── tools/
│   └── seal.mjs            ← encrypts a sealed page's contents (see Notes)
├── assets/
│   ├── logo.svg            ← EvZero logo (purple/black waves)
│   ├── solren-logo.svg
│   ├── favicon.svg
│   ├── favicon.png         ← the tab icon pages link to (favicon.svg holds JPEG bytes)
│   ├── game-valorant.svg
│   ├── game-bgmi.svg
│   └── game-marvelrivals.svg
├── CNAME                   ← GitHub Pages custom domain
├── _redirects              ← Netlify clean-URL redirects
├── vercel.json             ← Vercel clean-URL config
└── README.md
```

## Project pages

`/spice` and `/ais` are landing pages only — the applications themselves live in
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

- Social handles in the home page (`@evzero`, `discord.gg/evzero`, etc.) are
  placeholders — swap them in each page's HTML.
- Project entries are defined in `js/projects.js` under the `PROJECTS` object;
  add/remove/edit there.
- Solren rosters are literal HTML in `solren/index.html` — update player names
  and avatars directly.
- Game banners are inline SVG (`assets/game-*.svg`). Replace with real images
  if you'd rather use official game art (keep aspect ~16:10).
- CSS/JS links carry a `?v=` cache-buster. After editing a stylesheet or
  script, bump the number on every link to that file so visitors don't get a
  stale cached copy next to new HTML.
- Motion hooks (in `common.js` / `common.css`): `data-split` (letter blur-in),
  `data-lit` (words light up on scroll), `.reveal` + `d1`–`d7` (fade/rise),
  `.line-mask > .line` + `.intro-fade` (play when the curtain lifts),
  `data-marquee`, `data-magnetic`, `data-cursor-label="View"`.
- Page curtain: every page has a `.loader` that shows the `evzero` mark while
  it loads and sweeps in on page changes. The first homepage view of a
  session (sessionStorage `evz-welcomed`) plays `evzero` -> `WELCOME` on it
  before lifting; the welcome markup lives only in `index.html`.
- Sealed pages: a page can ship as just a password gate plus one encrypted
  blob (`<script id="seal">`). Everything behind the gate - markup, styles,
  script - is AES-GCM encrypted with a PBKDF2 key from the password, which is
  never stored anywhere. Edit one by opening it, changing the files, and
  sealing it again:
  `node tools/seal.mjs open <page>/index.html .private/<page>` then
  `node tools/seal.mjs seal .private/<page> <page>/index.html`.
  `.private/` is git-ignored - never commit the opened files.
- Page-to-page scrolling: each page's `<main class="page panel-group">` and
  `<footer class="site-footer panel">` sit inside `<div class="panels">`, and
  every top-level `<section>` in main has the `panel` class. Panels pin once
  their bottom reaches the screen bottom and the next one slides over them.
  Keep `position: fixed` things (modals, toasts) *outside* `.panels`.

---

© EvZero. Built from zero.
