/* ============================================
   Work page - sticker picker + case file
   The picker stickers and the index rows both
   carry data-project; clicking either opens the
   case file for that project. Status and version
   live on the row in the HTML (data-status /
   data-kind / data-version); everything else is
   in PROJECTS below.
   ============================================ */

(function () {
  'use strict';

  const caseEl = document.getElementById('case');
  if (!caseEl) return;

  const art = caseEl.querySelector('.case-art');
  const chip = caseEl.querySelector('.case-chip');
  const ver = caseEl.querySelector('.case-ver');
  const title = caseEl.querySelector('.case-title');
  const desc = caseEl.querySelector('.case-desc');
  const spec = caseEl.querySelector('.case-spec');
  const filesLabel = caseEl.querySelector('.case-files-label');
  const files = caseEl.querySelector('.case-files');
  const actions = caseEl.querySelector('.case-actions');
  const count = caseEl.querySelector('.case-count');
  const panel = caseEl.querySelector('.case-panel');

  const PROJECTS = {
    'ais': {
      title: 'AiS',
      sticker: 'ais',
      type: 'Research prototype',
      stack: 'Python · Docker',
      since: '2026',
      desc: [
        'Agent-in-Sandbox. AI coding agents are increasingly handed write access to real files, which makes a hijacked one look exactly like a working one until after it has written. AiS takes the filesystem away entirely.',
        'The agent proposes a change against a filename: no path, no handle. The change is applied to a disposable copy inside a locked-down container and actually executed there, while a Python audit hook records every network call, file write and process spawn, and names the line responsible. A human sees the diff and what the code really did, side by side, and nothing reaches a real file until they approve.',
        'Evaluated on ten scripted edits, seven deliberately hostile: 100% caught, 0% false positives. The interesting one breaks the code and edits the test that would catch it. Every test passes, and it still gets flagged.',
        'Ten scenarios written by the same person who wrote the rules measures consistency, not robustness, so there is a second harness that generates novel attacks and scores them blind. It is allowed to fail: 25 attacks, 86% caught, 0 false positives, and three gaps named on the page rather than buried.',
        'The editor is now a real model, and the test that matters is whether it can be turned. One task hands it a file with instructions hidden in a docstring telling it to phone home. If it complies, the sandbox sees the connection and blocks the edit. The model is treated as the victim, never as the safeguard.',
        'The review screen is built for whoever actually has to approve an AI&rsquo;s change, not just engineers: anti-cheat for AI. The answer is the headline, a six-line checklist says why in plain words, and only the safe button is ever highlighted. The editor can also run on a free local model through Ollama, no API key.',
      ],
      files: [
        'ais/mediator/mediator.py',
        'ais/sandbox/tracer.py',
        'ais/verifier/rules.py',
        'ais/audit/log.py',
        'demo.py',
      ],
      actions: [
        { label: 'Open the AiS page', href: '../ais/' },
        { label: 'Source on GitHub', href: 'https://github.com/ritviksajeev/ais', external: true },
      ],
    },
    'spice': {
      title: 'Spice',
      sticker: 'spice',
      type: 'Desktop app',
      stack: 'Electron · React · TypeScript',
      since: '2026',
      desc: [
        'A desktop overlay for gamers. It drops a transparent, always-on-top layer on the monitor of your choice: a centre-locked crosshair, six preset shapes you can restyle (or your own PNG / GIF), an image library, and opt-in WASD and mouse visualizers.',
        'Anti-cheat-conscious by default: no process injection, no game memory access, no synthetic input. The optional input mirror uses the same passive Win32 hook Discord and OBS use. It is fine for EAC and BattlEye, off by default, and best left off for Vanguard.',
        'Saves profiles, knows about every monitor you have, lives in the system tray and checks for updates on launch.',
      ],
      files: [
        'electron/main.cjs',
        'electron/preload.cjs',
        'src/app/App.tsx',
        'README.md',
        'CHANGELOG.md',
      ],
      actions: [
        { label: 'Open the Spice page', href: '../spice/' },
        { label: 'Download v0.1.3-alpha', href: 'https://github.com/ritviksajeev/spice/releases/download/v0.1.3-alpha/Spice-v0.1.3-alpha-win-x64.zip', external: true },
      ],
    },
    'qres': {
      title: 'Qres',
      sticker: 'qres',
      type: 'Desktop app',
      stack: 'Electron · C# · Win32',
      since: '2026',
      desc: [
        'Press a key. Your resolution changes. Press it again, it changes back. Built for stretched-res players tired of walking through the Windows display settings every time they switch games.',
        'The quick grid is generated from the modes your panel actually reports: native, the stretched widths that keep its vertical lines, and same-shape lower resolutions. Refresh rate comes along for the ride: leave it on <em>highest available</em> and dropping to 1440&times;1080 keeps your 240 Hz instead of quietly falling back to 60.',
        'Game profiles switch on a process launching and restore native when it exits. Changes made in the window revert themselves after 15 seconds if you never confirm, so a mode your monitor can\'t display never leaves you on a black screen, while hotkey switches skip the dialog, because nothing should land on top of your game.',
        'No native node module and no committed binary: the Win32 layer is a small C# CLI the app compiles on first run with the csc.exe already inside Windows, then caches.',
      ],
      files: [
        'native/QresDisplay.cs',
        'electron/main.cjs',
        'electron/display.cjs',
        'src/App.tsx',
        'README.md',
      ],
      actions: [
        { label: 'Open the Qres page', href: '../qres/' },
        { label: 'Source on GitHub', href: 'https://github.com/ritviksajeev/Qres', external: true },
      ],
    },
    'clipped': {
      title: 'clipped',
      sticker: 'clipped',
      type: 'Desktop app',
      stack: 'Python · React · ffmpeg',
      since: '2026',
      desc: [
        'Twitch clips in, YouTube Shorts out. clipped watches the Twitch categories you pick, finds what&rsquo;s trending right now (or the top of the last 24 hours), and turns each clip into a vertical Short with word-by-word captions burned in.',
        'Speech-to-text runs on your own computer with faster-whisper, so every caption lands on the word. The video is reframed to 9:16, dead air is trimmed, a thumbnail is cut and a title is written, by templates for free or by Gemini, Claude, OpenRouter or a local Ollama model if you connect one.',
        'Every Short waits in a review queue until you approve it, or switch on autopilot and it posts to YouTube Shorts and Instagram Reels on your schedule. No accounts connected? Download it and post it yourself. It always credits the streamer and links the original clip, and it never posts the same moment twice.',
        'No clipped server exists. Your Twitch and YouTube keys live in the Windows keychain and only ever go to the service they belong to.',
      ],
      files: [
        'clipped/engine.py',
        'clipped/optimizer/ranking.py',
        'clipped/pipeline/runner.py',
        'clipped/desktop.py',
        'frontend/src/App.jsx',
      ],
      actions: [
        { label: 'Open the clipped page', href: '../clipped/' },
        { label: 'Get a key · from $2.99', href: '../clipped/buy/' },
      ],
    },
    'watchparty': {
      title: 'Watchparty',
      sticker: 'watchparty',
      type: 'Web app + extension',
      stack: 'Node · WebSockets',
      since: '2026',
      desc: [
        'Two browsers, one video, the same frame. The site embeds YouTube and Twitch directly and keeps every player in lockstep through a small Node WebSocket relay.',
        'The extension picks up where embedding can\'t: Netflix, Disney+, HBO, anywhere a site blocks framing. It speaks the same wire protocol, so someone on the site and someone on the extension stay in sync with each other.',
        'Create a room, share the link, press play. No screenshare, no quality loss.',
      ],
      files: [
        'server/server.js',
        'js/player-web.js',
        'watchparty/index.html',
        'extension/content.js',
        'extension/background.js',
      ],
      actions: [{ label: 'Open Watchparty', href: '../watchparty/' }],
    },
    'sketch-fighter': {
      title: 'Sketch Fighter',
      sticker: 'sketch',
      type: 'Game (abandoned)',
      stack: 'Flask · Phaser 3 · OpenCV',
      since: '2026',
      desc: [
        'Draw a fighting-game stage on an index card, photograph it with your phone, and fight on it seconds later.',
        'The photo goes through an OpenCV pipeline that turns pen lines into a 40 &times; 24 tile grid, then a stage analyser works out what is actually reachable, fixes what isn&rsquo;t, picks spawn points and builds a navigation graph so the CPU opponent can get around a level it has never seen.',
        'I have stopped working on it, so it is marked abandoned. The build on this site still plays the sample stages in your browser, in landscape on a phone too. Scanning your own card only ever worked against a local server.',
      ],
      files: [
        'backend/vision.py',
        'backend/stage_analysis.py',
        'frontend/src/sim/',
        'frontend/src/scenes/',
        'shared/game.json',
      ],
      actions: [
        { label: 'Play the sample stages', href: '../sketch/' },
        { label: 'Source on GitHub', href: 'https://github.com/ritviksajeev/ev/tree/main/sketch-fighter', external: true },
      ],
    },
    'pixel-cat': {
      title: 'Pixel cat',
      sticker: 'cat',
      type: 'Site pet',
      stack: 'Vanilla JS · SVG',
      since: '2026',
      desc: [
        'The cat wandering every page of this site. A small state machine runs every frame: it idles, wanders off to a random spot, curls up for a nap (with a floating z), and every so often says something: meow!, prr..., mrrp, pspsps?',
        'It keeps an eye on your cursor. Get near and it turns to face you, sometimes it stalks over, and if the cursor gets close it pounces. Click it and it meows and pounces on the spot.',
        'Three hand-placed 16&times;16 SVG sprites (standing, curled up asleep, mid-pounce) built from plain rects with crisp edges, so they stay sharp at any size. Plain JavaScript, no libraries. It hides on small screens, where there is no cursor to chase.',
      ],
      files: ['js/cat.js', 'css/site.css'],
      actions: [{ label: 'View the source', href: 'https://github.com/ritviksajeev/ev/blob/main/js/cat.js', external: true }],
    },
    'evzero-org': {
      title: 'evzero.org',
      sticker: 'site',
      type: 'Website',
      stack: 'HTML · CSS · JS',
      since: '2025',
      desc: [
        'The site you&rsquo;re on. Version three: a warp field behind every hero, a menu made of stickers, sections that slide over each other like pages, a shelf of 3D slabs, and a cat.',
        'No framework and no build step. Every animation here is hand-written CSS and JavaScript. The only library on the page is the one that smooths the scroll.',
      ],
      files: ['index.html', 'css/site.css', 'js/site.js', 'js/cat.js'],
      actions: [{ label: 'Source on GitHub', href: 'https://github.com/ritviksajeev/ev', external: true }],
    },
    'valorant-tracker': {
      title: 'Valorant tracker',
      sticker: 'tracker',
      type: 'Web app',
      stack: 'Henrik API · Node proxy',
      since: '2026',
      desc: [
        'Type a Riot ID, get a rank card, recent form and a full match log. Data comes from Henrik&rsquo;s community Valorant API through a small proxy, so the key never reaches the browser.',
        'It&rsquo;s marked outdated: the page still loads, but expect ranks and match data to be stale or missing.',
      ],
      files: [
        'valorant/index.html',
        'css/valorant.css',
        'js/valorant.js',
        'server/valorant.js',
      ],
      actions: [{ label: 'Open the tracker', href: '../valorant/' }],
    },
    'mystery': {
      title: '???',
      sticker: 'mystery',
      type: 'Classified',
      stack: '[redacted]',
      since: 'Soon',
      desc: [
        'Still under the tarp. Check back later.',
        'If you really want a hint: it probably involves purple.',
      ],
      files: [],
      actions: [],
    },
  };

  const rows = Array.from(document.querySelectorAll('.pr-row[data-project]'));
  const order = rows.map((r) => r.dataset.project).filter((id) => PROJECTS[id]);
  const rowFor = (id) => rows.find((r) => r.dataset.project === id);
  const sticker = (name) => (window.EV && window.EV.sticker ? window.EV.sticker(name) : '');
  const pad = (n) => String(n).padStart(2, '0');

  let current = null;
  let lastFocus = null;

  // Scroll lock via site.js (keeps the pinned page panels intact); plain
  // <html> overflow as a fallback if site.js isn't there.
  function lockPage(on) {
    const ev = window.EV;
    if (ev && typeof ev.lock === 'function') {
      if (on) ev.lock(); else ev.unlock();
    } else {
      document.documentElement.style.overflow = on ? 'hidden' : '';
    }
  }

  function fill(id) {
    const data = PROJECTS[id];
    const row = rowFor(id);
    const status = row ? row.dataset.status : '';
    const kind = row ? row.dataset.kind : '';
    const version = row ? row.dataset.version : '';

    // Exposed so a name with deliberate casing (AiS) can opt out of uppercase.
    caseEl.dataset.project = id;
    art.innerHTML = sticker(data.sticker);
    chip.className = 'chip case-chip ' + kind;
    chip.textContent = status;
    ver.textContent = version;
    title.textContent = data.title;
    desc.innerHTML = data.desc.map((p) => '<p>' + p + '</p>').join('');
    spec.innerHTML = [
      ['Type', data.type],
      ['Built with', data.stack],
      ['Since', data.since],
      ['Status', status + (version ? ' · ' + version : '')],
    ].map(([k, v]) => '<div class="spec-row"><dt>' + k + '</dt><dd>' + v + '</dd></div>').join('');
    files.innerHTML = data.files.map((f) => '<span>' + f + '</span>').join('');
    filesLabel.style.display = data.files.length ? '' : 'none';
    actions.innerHTML = (data.actions || []).map((a, i) => {
      const cls = 'btn' + (i === 0 ? ' shine' : ' ghost');
      const arrow = ' <span class="arrow">' + (a.external ? '&#8599;' : '&rarr;') + '</span>';
      return a.external
        ? '<a class="' + cls + '" href="' + a.href + '" target="_blank" rel="noreferrer noopener">' + a.label + arrow + '</a>'
        : '<a class="' + cls + '" href="' + a.href + '" data-transition>' + a.label + arrow + '</a>';
    }).join('');
    count.textContent = pad(order.indexOf(id) + 1) + ' / ' + pad(order.length);
    panel.scrollTop = 0;
  }

  function open(id) {
    if (!PROJECTS[id]) return;
    const wasOpen = caseEl.classList.contains('open');
    if (!wasOpen) lastFocus = document.activeElement;
    fill(id);
    current = id;
    if (wasOpen) {
      art.classList.remove('swap');
      void art.offsetWidth;
      art.classList.add('swap');
    } else {
      caseEl.classList.add('open');
      caseEl.setAttribute('aria-hidden', 'false');
      document.documentElement.classList.add('case-open');
      lockPage(true);
      const closeBtn = caseEl.querySelector('.case-close');
      setTimeout(() => closeBtn.focus({ preventScroll: true }), 80);
    }
    if (history.replaceState) history.replaceState(null, '', '#' + id);
  }
  function close() {
    if (!caseEl.classList.contains('open')) return;
    caseEl.classList.remove('open');
    caseEl.setAttribute('aria-hidden', 'true');
    document.documentElement.classList.remove('case-open');
    art.classList.remove('swap');
    lockPage(false);
    current = null;
    if (history.replaceState) history.replaceState(null, '', location.pathname + location.search);
    if (lastFocus && typeof lastFocus.focus === 'function') lastFocus.focus({ preventScroll: true });
    lastFocus = null;
  }
  function step(dir) {
    if (!current) return;
    const i = order.indexOf(current);
    open(order[(i + dir + order.length) % order.length]);
  }

  document.querySelectorAll('[data-project]').forEach((el) => {
    if (el === caseEl) return;
    el.addEventListener('click', (e) => {
      e.preventDefault();
      open(el.dataset.project);
    });
    if (el.getAttribute('role') === 'button') {
      el.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          open(el.dataset.project);
        }
      });
    }
  });
  caseEl.querySelector('.case-close').addEventListener('click', close);
  caseEl.querySelector('.case-backdrop').addEventListener('click', close);
  caseEl.querySelector('.case-stage').addEventListener('click', (e) => {
    if (e.target === e.currentTarget) close();
  });
  caseEl.querySelector('.case-prev').addEventListener('click', () => step(-1));
  caseEl.querySelector('.case-next').addEventListener('click', () => step(1));
  document.addEventListener('keydown', (e) => {
    if (!caseEl.classList.contains('open')) return;
    if (e.key === 'Escape') close();
    else if (e.key === 'ArrowRight') step(1);
    else if (e.key === 'ArrowLeft') step(-1);
  });

  // /projects/#pixel-cat opens that case file straight away (once the curtain is up).
  const wanted = decodeURIComponent(location.hash.slice(1));
  if (PROJECTS[wanted]) {
    const go = () => setTimeout(() => open(wanted), 500);
    if (window.EV && typeof window.EV.onReady === 'function') window.EV.onReady(go); else go();
  }
})();
