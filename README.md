# evzero.org

Personal site + Solren esports hub. Dark purple glass theme, snap-scroll sections,
custom cursor, a pixel cat that chases your mouse, and zero frameworks.

Pure HTML / CSS / vanilla JS — drop anywhere that serves static files.

## Pages

| URL                  | Source                  |
|----------------------|-------------------------|
| `/`                  | `index.html`            |
| `/projects/`         | `projects/index.html`   |
| `/solren/`           | `solren/index.html`     |
| `/contact/`          | `contact/index.html`    |

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

## Running locally

Any static file server works. Two easy options:

```bash
# Python
python -m http.server 8080

# Node
npx serve .
```

Then open `http://localhost:8080`.

You can also just double-click `index.html` — the directory-based URLs work on
`file://` too.

## Deploying

The site is static. Anywhere that serves HTML will work. Three common options:

### GitHub Pages
1. Push this folder to a repo.
2. Settings → Pages → Deploy from `main` → `/ (root)`.
3. The `CNAME` file already points at `evzero.org`.
4. Add an A/CNAME DNS record at your registrar pointing to GitHub Pages.

### Netlify
1. Drag-and-drop this folder into app.netlify.com.
2. Clean URLs work out of the box via `_redirects`.
3. Add your custom domain in Netlify settings.

### Vercel
1. `vercel --prod` from this directory.
2. `vercel.json` handles clean URLs.
3. Add your custom domain in the Vercel dashboard.

## Theme tokens

All colors and sizing live as CSS custom properties at the top of `css/common.css`:

```css
--purple:        #8a2be2;   /* primary */
--purple-bright: #a855f7;   /* accent */
--purple-dim:    #5a14a8;   /* deep */
--bg-0:          #06040c;   /* near-black */
--glass-bg:      rgba(22, 12, 40, 0.45);
```

Change those and the whole site re-themes.

## The cat

`js/cat.js` is a self-contained state machine — idle / walking / playing /
sleeping — that lives on `window` and tracks the cursor. States:

- **far from cursor** → wanders randomly, occasionally naps
- **medium distance** → watches / faces the cursor
- **close** → chases
- **very close** → snuggles and meows

Click the cat for an extra meow.

## The cursor

Custom cursor with a white dot + purple ring that lags behind. It enlarges on
hoverable elements (`a`, `button`, `input`, `[data-cursor="hover"]`). On
screens narrower than 860px the native cursor comes back automatically.

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
