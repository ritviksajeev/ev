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

## File layout

```
website-evzero/
├── index.html              ← home page
├── projects/index.html     ← shop-style project grid + modal
├── solren/index.html       ← esports team, tabbed by game
├── contact/index.html      ← discord + email
├── css/
│   ├── common.css          ← theme, nav, cat, cursor, scroll
│   ├── home.css
│   ├── projects.css
│   ├── solren.css
│   └── contact.css
├── js/
│   ├── common.js           ← cursor, starfield, section observer, page curtain
│   ├── cat.js              ← pixel cat state machine
│   ├── projects.js         ← filter tabs + project modal + SVG covers
│   └── solren.js           ← game tab switcher
├── assets/
│   ├── logo.svg            ← EvZero logo (purple/black waves)
│   ├── solren-logo.svg
│   ├── favicon.svg
│   ├── game-valorant.svg
│   ├── game-bgmi.svg
│   └── game-marvelrivals.svg
├── CNAME                   ← GitHub Pages custom domain
├── _redirects              ← Netlify clean-URL redirects
├── vercel.json             ← Vercel clean-URL config
└── README.md
```

## Notes & TODOs

- Social handles in the home page (`@evzero`, `discord.gg/evzero`, etc.) are
  placeholders — swap them in each page's HTML.
- Project entries are defined in `js/projects.js` under the `PROJECTS` object;
  add/remove/edit there.
- Solren rosters are literal HTML in `solren/index.html` — update player names
  and avatars directly.
- Game banners are inline SVG (`assets/game-*.svg`). Replace with real images
  if you'd rather use official game art (keep aspect ~16:10).

---

© EvZero. Built from zero.
