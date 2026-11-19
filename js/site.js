/* ============================================
   EvZero - Site JS (v3)
   Page curtain + homepage welcome, Lenis scroll,
   custom cursor, sticker menu, command palette,
   chapter dock, page panels, scroll motion
   (reveals, scrubbed drift, velocity), warp field,
   stickers, glow cards, sound, build log.
   (js/common.js is the frozen v2 script, kept
   only for the sealed page that still links it.)
   ============================================ */

(function () {
  'use strict';

  const doc = document.documentElement;
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const finePointer = window.matchMedia('(hover: hover) and (pointer: fine)');
  const ROOT = doc.getAttribute('data-root') || '';   // "" on the homepage, "../" one level down, "/" on the 404

  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
  const clamp = (v, min, max) => Math.min(max, Math.max(min, v));
  const safe = (name, fn) => {
    try { fn(); } catch (err) { console.error('[evzero] ' + name, err); }
  };

  function fontsReady(cap) {
    const fonts = document.fonts && document.fonts.ready ? document.fonts.ready : Promise.resolve();
    return Promise.race([fonts, new Promise((resolve) => setTimeout(resolve, cap))]);
  }

  // --------------------------------------------
  // Ready gate - intro animations + reveals wait
  // until the curtain lifts.
  // --------------------------------------------
  let ready = false;
  const readyQueue = [];
  function onReady(fn) {
    if (ready) fn(); else readyQueue.push(fn);
  }
  function markReady() {
    if (ready) return;
    ready = true;
    doc.classList.add('is-ready');
    readyQueue.splice(0).forEach((fn) => safe('ready', fn));
  }

  // --------------------------------------------
  // Scroll registry - one rAF per frame, works for
  // Lenis (it drives window.scrollTo) and native.
  // --------------------------------------------
  const scrollFns = [];
  let scrollQueued = false;
  function onScroll(fn) { scrollFns.push(fn); }
  function flushScroll() {
    scrollQueued = false;
    const y = window.scrollY || window.pageYOffset || 0;
    for (const fn of scrollFns) safe('scroll', () => fn(y));
  }
  function queueScroll() {
    if (scrollQueued) return;
    scrollQueued = true;
    requestAnimationFrame(flushScroll);
  }
  window.addEventListener('scroll', queueScroll, { passive: true });
  window.addEventListener('resize', queueScroll);

  // --------------------------------------------
  // Smooth scroll (Lenis, vendored). Falls back to
  // native scrolling if missing or reduced motion.
  // --------------------------------------------
  let lenis = null;
  function initSmoothScroll() {
    if (reduceMotion || typeof window.Lenis !== 'function') return;
    lenis = new window.Lenis({
      autoRaf: true,
      lerp: 0.085,
      smoothWheel: true,
      allowNestedScroll: true,
    });
  }

  // Scroll lock for the menu / case file. Locks <html> (never <body>, which
  // would become its own scroll container and un-pin the panels) and pauses Lenis.
  let lockCount = 0;
  function applyLock() {
    const locked = lockCount > 0 || doc.classList.contains('menu-open');
    doc.classList.toggle('is-locked', locked);
    if (lenis) {
      if (locked) lenis.stop(); else lenis.start();
    }
  }
  function lockScroll() { lockCount++; applyLock(); }
  function unlockScroll() { lockCount = Math.max(0, lockCount - 1); applyLock(); }

  // Pinned panels report their stuck position, so measure where an element
  // sits in normal flow before scrolling to it.
  function naturalY(el) {
    doc.classList.add('panels-measure');
    const y = el.getBoundingClientRect().top + (window.scrollY || 0);
    doc.classList.remove('panels-measure');
    return y;
  }
  function scrollToEl(el) {
    if (!el) return;
    const y = naturalY(el);
    if (lenis) lenis.scrollTo(y, { duration: 1.4 });
    else window.scrollTo({ top: y, behavior: reduceMotion ? 'auto' : 'smooth' });
  }
  function scrollToTop() {
    if (lenis) lenis.scrollTo(0, { duration: 1.4 });
    else window.scrollTo({ top: 0, behavior: reduceMotion ? 'auto' : 'smooth' });
  }

  // --------------------------------------------
  // Page curtain - covers the page while it loads,
  // then lifts. The first homepage view of a session
  // plays "evzero" -> "welcome" on it first.
  // --------------------------------------------
  function initLoader() {
    // Scripts are running, so they own the curtain from here - drop the
    // inline head script's blanket failsafe (it would cut the welcome short).
    clearTimeout(window.evzFailsafe);
    const loader = $('.loader');
    if (!loader) { markReady(); return; }

    let fresh = false;
    if ($('.loader-welcome', loader) && !reduceMotion) {
      try {
        fresh = !sessionStorage.getItem('evz-welcomed');
        sessionStorage.setItem('evz-welcomed', '1');
      } catch (err) { /* storage blocked - skip the welcome */ }
    }

    // Plain curtain: lift once fonts are in (capped).
    if (!fresh) {
      fontsReady(650).then(() => setTimeout(markReady, 80));
      setTimeout(markReady, 1500);
      return;
    }

    // Welcome: hold the "evzero" mark (the same curtain page changes use),
    // roll WELCOME in and let it sit, then send it up as the curtain lifts.
    const HOLD_MARK = 1500;
    const HOLD_WELCOME = 3000;
    const t0 = performance.now();
    let played = false;
    function play() {
      if (played) return;
      played = true;
      loader.classList.add('is-welcome');
      setTimeout(() => {
        loader.classList.add('is-out');
        setTimeout(markReady, 300);
      }, HOLD_WELCOME);
    }
    fontsReady(2500).then(() => setTimeout(play, Math.max(0, HOLD_MARK - (performance.now() - t0))));
    // Never strand anyone behind the curtain.
    setTimeout(markReady, 9500);
  }

  // --------------------------------------------
  // Page transitions - curtain up, then navigate
  // --------------------------------------------
  function initTransitions() {
    // In-page anchors (<a href="#run">): glide to where the target sits in
    // normal flow - pinned panels make the browser's own jump unreliable.
    document.addEventListener('click', (e) => {
      if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const a = e.target.closest && e.target.closest('a[href^="#"]');
      if (!a || a.hasAttribute('data-transition')) return;
      const id = decodeURIComponent((a.getAttribute('href') || '').slice(1));
      const target = id && document.getElementById(id);
      if (!target) return;
      e.preventDefault();
      closeMenu();
      scrollToEl(target);
      if (history.replaceState) history.replaceState(null, '', '#' + id);
    });

    document.addEventListener('click', (e) => {
      if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const a = e.target.closest && e.target.closest('a[data-transition]');
      if (!a) return;
      if ((a.target && a.target !== '_self') || a.hasAttribute('download')) return;
      const raw = a.getAttribute('href') || '';
      if (!raw || raw.charAt(0) === '#' || /^(mailto|tel|javascript):/i.test(raw)) return;

      let url;
      try { url = new URL(a.href, location.href); } catch (err) { return; }
      if (url.origin !== location.origin) return;

      e.preventDefault();
      // Same page: just glide back up instead of reloading.
      if (url.pathname === location.pathname && url.search === location.search) {
        closeMenu();
        if (url.hash) scrollToEl($(url.hash)); else scrollToTop();
        return;
      }
      leave(url.href);
    });

    // Back/forward cache restores the page mid-transition - reset it.
    window.addEventListener('pageshow', (e) => {
      if (!e.persisted) return;
      doc.classList.remove('is-leaving');
      closeMenu();
      applyLock();
      markReady();
    });
  }
  function leave(href) {
    if (doc.classList.contains('is-leaving')) return;
    doc.classList.add('is-leaving');
    setTimeout(() => { window.location.href = href; }, reduceMotion ? 0 : 680);
  }

  // --------------------------------------------
  // Stickers - die-cut marks, one per place on
  // the site. `cut` is the silhouette (drawn fat
  // and white underneath), `art` sits on top.
  // --------------------------------------------
  const INK = '#0d0b14', P1 = '#8a78f0', P2 = '#b4a5ff', LAV = '#dcd6ff', DEEP = '#4c3aa8', WHITE = '#f6f3ee';
  const STICKERS = {
    home: {   // the glass cube
      cut: '<polygon points="100,24 166,62 166,138 100,176 34,138 34,62"/>',
      art: `<polygon points="100,24 166,62 100,100 34,62" fill="${LAV}"/>
            <polygon points="34,62 100,100 100,176 34,138" fill="${P1}"/>
            <polygon points="166,62 166,138 100,176 100,100" fill="${DEEP}"/>`,
    },
    work: {   // a shelf of slabs
      cut: '<rect x="36" y="38" width="128" height="38" rx="11"/><rect x="24" y="81" width="152" height="38" rx="11"/><rect x="42" y="124" width="116" height="38" rx="11"/>',
      art: `<rect x="36" y="38" width="128" height="38" rx="11" fill="${LAV}"/>
            <rect x="24" y="81" width="152" height="38" rx="11" fill="${P2}"/>
            <rect x="42" y="124" width="116" height="38" rx="11" fill="${P1}"/>
            <path d="M54 57H96M44 100H104M60 143H92" fill="none"/>
            <circle cx="144" cy="57" r="5" fill="${INK}" stroke="none"/><circle cx="154" cy="100" r="5" fill="${INK}" stroke="none"/><circle cx="138" cy="143" r="5" fill="${INK}" stroke="none"/>`,
    },
    contact: {   // speech bubble
      cut: '<path d="M42 44H158Q178 44 178 64V116Q178 136 158 136H108L72 170V136H42Q22 136 22 116V64Q22 44 42 44Z"/>',
      art: `<path d="M42 44H158Q178 44 178 64V116Q178 136 158 136H108L72 170V136H42Q22 136 22 116V64Q22 44 42 44Z" fill="${WHITE}"/>
            <circle cx="66" cy="90" r="9" fill="${P1}" stroke="none"/><circle cx="100" cy="90" r="9" fill="${P1}" stroke="none"/><circle cx="134" cy="90" r="9" fill="${P1}" stroke="none"/>`,
    },
    ais: {   // shield, sandbox, agent
      cut: '<path d="M100 18L168 43V98C168 141 139 167 100 182C61 167 32 141 32 98V43Z"/>',
      art: `<path d="M100 18L168 43V98C168 141 139 167 100 182C61 167 32 141 32 98V43Z" fill="${P1}"/>
            <rect x="64" y="60" width="72" height="72" rx="16" fill="${INK}" stroke="${LAV}" stroke-width="5"/>
            <circle cx="100" cy="96" r="14" fill="${WHITE}" stroke="none"/>`,
    },
    spice: {   // overlay brackets + crosshair
      cut: '<rect x="28" y="28" width="144" height="144" rx="36"/>',
      art: `<rect x="28" y="28" width="144" height="144" rx="36" fill="${LAV}"/>
            <path d="M60 84V60H84M116 60H140V84M60 116V140H84M116 140H140V116" fill="none" stroke-width="9"/>
            <path d="M100 78V91M100 109V122M78 100H91M109 100H122" fill="none" stroke="${DEEP}" stroke-width="8"/>`,
    },
    qres: {   // a monitor being squeezed
      cut: '<rect x="22" y="38" width="156" height="108" rx="18"/><path d="M76 166H124L118 140H82Z"/>',
      art: `<path d="M76 166H124L118 140H82Z" fill="${DEEP}"/>
            <rect x="22" y="38" width="156" height="108" rx="18" fill="${P2}"/>
            <rect x="40" y="55" width="120" height="74" rx="9" fill="${INK}" stroke="none"/>
            <path d="M70 92H130M83 79L70 92L83 105M117 79L130 92L117 105" fill="none" stroke="${WHITE}"/>`,
    },
    clipped: {   // a Short, with a play button and a caption bar
      cut: '<rect x="50" y="18" width="100" height="164" rx="24" transform="rotate(-8 100 100)"/>',
      art: `<g transform="rotate(-8 100 100)">
              <rect x="50" y="18" width="100" height="164" rx="24" fill="${P1}"/>
              <rect x="64" y="36" width="72" height="96" rx="12" fill="${INK}" stroke="${LAV}" stroke-width="5"/>
              <path d="M90 66L114 84L90 102Z" fill="${WHITE}" stroke="none"/>
              <rect x="62" y="144" width="76" height="20" rx="10" fill="${LAV}"/>
              <rect x="70" y="150" width="22" height="8" rx="4" fill="${DEEP}" stroke="none"/>
              <rect x="98" y="150" width="32" height="8" rx="4" fill="${P2}" stroke="none"/>
            </g>`,
    },
    watchparty: {   // two screens, one frame
      cut: '<rect x="22" y="34" width="114" height="80" rx="15"/><rect x="64" y="86" width="114" height="80" rx="15"/>',
      art: `<rect x="22" y="34" width="114" height="80" rx="15" fill="${DEEP}"/>
            <polygon points="62,58 62,90 90,74" fill="${LAV}" stroke="none"/>
            <rect x="64" y="86" width="114" height="80" rx="15" fill="${LAV}"/>
            <polygon points="108,108 108,144 140,126" fill="${INK}" stroke="none"/>`,
    },
    sketch: {   // an index card with a fight drawn on it, and the pencil
      cut: '<rect x="28" y="52" width="124" height="112" rx="13" transform="rotate(-8 90 108)"/><path d="M140 41Q140 34 147 34H159Q166 34 166 41V128L153 154L140 128Z" transform="rotate(28 153 95)"/>',
      art: `<g transform="rotate(-8 90 108)">
              <rect x="28" y="52" width="124" height="112" rx="13" fill="${WHITE}"/>
              <path d="M48 136H98M88 112H132" fill="none" stroke-width="6"/>
              <circle cx="68" cy="100" r="8" fill="${P1}" stroke-width="5"/>
              <path d="M68 108V124M68 114L84 108M68 114L58 120M68 124L60 134M68 124L77 134" fill="none" stroke-width="5"/>
            </g>
            <g transform="rotate(28 153 95)">
              <path d="M140 41Q140 34 147 34H159Q166 34 166 41V128L153 154L140 128Z" fill="${P1}"/>
              <path d="M140 52H166M140 128H166" fill="none" stroke-width="5"/>
            </g>`,
    },
    cat: {
      cut: '<path d="M40 78L53 28L87 58H113L147 28L160 78V128Q160 170 118 170H82Q40 170 40 128Z"/>',
      art: `<path d="M40 78L53 28L87 58H113L147 28L160 78V128Q160 170 118 170H82Q40 170 40 128Z" fill="${P2}"/>
            <rect x="68" y="94" width="15" height="22" rx="7.5" fill="${INK}" stroke="none"/><rect x="117" y="94" width="15" height="22" rx="7.5" fill="${INK}" stroke="none"/>
            <path d="M92 126H108L100 136Z" fill="${WHITE}" stroke-width="4"/>`,
    },
    tracker: {   // a target that has seen better days
      cut: '<circle cx="100" cy="100" r="76"/>',
      art: `<circle cx="100" cy="100" r="76" fill="#2a2342"/>
            <circle cx="100" cy="100" r="44" fill="none" stroke="${P2}" stroke-width="6"/>
            <path d="M100 38V70M100 130V162M38 100H70M130 100H162" fill="none" stroke="${LAV}"/>
            <circle cx="100" cy="100" r="8" fill="${LAV}" stroke="none"/>`,
    },
    site: {   // a browser window
      cut: '<rect x="22" y="36" width="156" height="128" rx="18"/>',
      art: `<rect x="22" y="36" width="156" height="128" rx="18" fill="${LAV}"/>
            <path d="M22 72H178" fill="none"/>
            <circle cx="44" cy="54" r="5.5" fill="${INK}" stroke="none"/><circle cx="62" cy="54" r="5.5" fill="${INK}" stroke="none"/><circle cx="80" cy="54" r="5.5" fill="${INK}" stroke="none"/>
            <path d="M44 104Q62 88 80 104T116 104T152 104" fill="none" stroke="${DEEP}" stroke-width="8"/>
            <path d="M44 134Q62 118 80 134T116 134T152 134" fill="none" stroke="${P1}" stroke-width="8"/>`,
    },
    resume: {   // a page with a name on it
      cut: '<path d="M52 22H126L158 54V170Q158 180 148 180H52Q42 180 42 170V32Q42 22 52 22Z"/>',
      art: `<path d="M52 22H126L158 54V170Q158 180 148 180H52Q42 180 42 170V32Q42 22 52 22Z" fill="${WHITE}"/>
            <path d="M126 22V54H158" fill="${LAV}"/>
            <circle cx="76" cy="74" r="13" fill="${P1}"/>
            <path d="M64 112H136M64 134H136M64 156H108" fill="none" stroke="${DEEP}" stroke-width="8"/>`,
    },
    cpu: {   // a chip with a bar chart on the die (scheduling)
      cut: '<rect x="40" y="40" width="120" height="120" rx="20"/><path d="M70 24V40M100 24V40M130 24V40M70 160V176M100 160V176M130 160V176M24 70H40M24 100H40M24 130H40M160 70H176M160 100H176M160 130H176"/>',
      art: `<path d="M70 26V40M100 26V40M130 26V40M70 160V174M100 160V174M130 160V174M26 70H40M26 100H40M26 130H40M160 70H174M160 100H174M160 130H174" fill="none"/>
            <rect x="40" y="40" width="120" height="120" rx="20" fill="${P1}"/>
            <rect x="62" y="62" width="76" height="76" rx="12" fill="${INK}" stroke="none"/>
            <path d="M80 122V108M95 122V90M110 122V100M125 122V80" fill="none" stroke="${LAV}" stroke-width="9"/>`,
    },
    bot: {   // a service robot's head
      cut: '<rect x="32" y="58" width="136" height="106" rx="28"/><path d="M100 58V30"/><circle cx="100" cy="26" r="14"/>',
      art: `<path d="M100 58V36" fill="none"/>
            <circle cx="100" cy="28" r="11" fill="${P2}"/>
            <rect x="32" y="58" width="136" height="106" rx="28" fill="${LAV}"/>
            <rect x="52" y="80" width="96" height="58" rx="16" fill="${INK}" stroke="none"/>
            <circle cx="80" cy="106" r="9" fill="${P2}" stroke="none"/><circle cx="120" cy="106" r="9" fill="${P2}" stroke="none"/>
            <path d="M88 124Q100 132 112 124" fill="none" stroke="${P2}" stroke-width="5"/>`,
    },
    mystery: {
      cut: '<circle cx="100" cy="100" r="74"/>',
      art: `<circle cx="100" cy="100" r="74" fill="${INK}" stroke="${P2}" stroke-dasharray="15 13"/>
            <path d="M78 84Q78 60 100 60Q124 60 124 82Q124 96 108 104Q100 108 100 120" fill="none" stroke="${LAV}" stroke-width="11"/>
            <circle cx="100" cy="142" r="8" fill="${LAV}" stroke="none"/>`,
    },
  };
  function sticker(name) {
    const s = STICKERS[name] || STICKERS.mystery;
    return '<svg class="stk" viewBox="0 0 200 200" aria-hidden="true" focusable="false">' +
      '<g fill="' + WHITE + '" stroke="' + WHITE + '" stroke-width="22" stroke-linejoin="round" stroke-linecap="round">' + s.cut + '</g>' +
      '<g stroke="' + INK + '" stroke-width="7" stroke-linejoin="round" stroke-linecap="round">' + s.art + '</g></svg>';
  }
  function initStickers(root) {
    $$('[data-sticker]', root || document).forEach((el) => {
      if (el.firstElementChild) return;
      el.innerHTML = sticker(el.getAttribute('data-sticker'));
    });
  }

  // --------------------------------------------
  // Menu - a sticker picker (Avara). Pops open
  // from the Menu button.
  // --------------------------------------------
  const MENU_PAGES = [
    { key: 'home',    label: 'Home',    note: 'start',      href: '',          r: -7 },
    { key: 'work',    label: 'Work',    note: '10 on shelf', href: 'projects/', r: 5 },
    { key: 'contact', label: 'Say hi',  note: 'reach me',   href: 'contact/',  r: -4 },
    { key: 'resume',  label: 'R\u00e9sum\u00e9',  note: 'one page',   href: 'resume/',   r: 6 },
  ];
  const MENU_PROJECTS = [
    { key: 'ais',        label: 'AiS',            href: 'ais/',        r: -6 },
    { key: 'spice',      label: 'Spice',          href: 'spice/',      r: 7 },
    { key: 'qres',       label: 'Qres',           href: 'qres/',       r: -4 },
    { key: 'clipped',    label: 'clipped',        href: 'clipped/',    r: 5 },
    { key: 'watchparty', label: 'Watchparty',     href: 'watchparty/', r: 6 },
    { key: 'tracker',    label: 'Tracker',        href: 'valorant/',   r: 4 },
  ];
  let menuBtn = null;
  let menuEl = null;
  function initMenu() {
    menuBtn = $('.menu-btn');
    if (!menuBtn) return;
    const here = document.body.getAttribute('data-page') || '';

    const item = (m, i) =>
      '<a class="menu-item' + (m.key === here ? ' active' : '') + '" href="' + ROOT + m.href + '" data-transition style="--i:' + i + ';--r:' + m.r + 'deg" aria-label="' + m.label + '">' +
      '<span class="tip">' + m.label + (m.note ? '<small>' + m.note + '</small>' : '') + '</span>' + sticker(m.key) + '</a>';

    menuEl = document.createElement('div');
    menuEl.className = 'menu';
    menuEl.id = 'site-menu';
    menuEl.setAttribute('aria-hidden', 'true');
    menuEl.setAttribute('data-lenis-prevent', '');
    menuEl.innerHTML =
      '<nav class="menu-main" aria-label="Menu">' + MENU_PAGES.map(item).join('') + '</nav>' +
      '<div class="menu-sub"><div class="menu-sub-label">( or jump straight into a project )</div>' +
      '<nav class="menu-sub-row" aria-label="Projects">' + MENU_PROJECTS.map((m, i) => item(m, i + 4)).join('') + '</nav></div>' +
      '<div class="menu-foot"><b>EVZERO</b><div class="menu-foot-links">' +
      '<a href="https://youtube.com/@evzero" target="_blank" rel="noreferrer noopener">YouTube</a><i>&middot;</i>' +
      '<a href="https://discord.gg/hrN8ye6nrF" target="_blank" rel="noreferrer noopener">Discord</a><i>&middot;</i>' +
      '<a href="https://twitch.tv/evzero" target="_blank" rel="noreferrer noopener">Twitch</a><i>&middot;</i>' +
      '<a href="mailto:r@evzero.org">Email</a></div></div>';
    document.body.appendChild(menuEl);

    menuBtn.addEventListener('click', () => toggleMenu());
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && doc.classList.contains('menu-open')) {
        closeMenu();
        menuBtn.focus();
      }
    });
  }
  function toggleMenu(force) {
    if (!menuBtn) return;
    const open = typeof force === 'boolean' ? force : !doc.classList.contains('menu-open');
    doc.classList.toggle('menu-open', open);
    menuBtn.setAttribute('aria-expanded', String(open));
    const label = $('.menu-btn-label', menuBtn);
    if (label) label.textContent = open ? 'Close' : 'Menu';
    if (menuEl) menuEl.setAttribute('aria-hidden', String(!open));
    applyLock();
    sfx(open ? 'open' : 'close');
    if (open) {
      const first = menuEl && $('a', menuEl);
      if (first) setTimeout(() => first.focus({ preventScroll: true }), 500);
    }
  }
  function closeMenu() {
    if (doc.classList.contains('menu-open')) toggleMenu(false);
  }

  // --------------------------------------------
  // Chapter dock - names the section on screen
  // and lists the others (built from [data-chapter])
  // --------------------------------------------
  function initDock() {
    const chapters = $$('.panels [data-chapter]');
    if (chapters.length < 2) return;
    const pad = (n) => String(n).padStart(2, '0');

    const dock = document.createElement('div');
    dock.className = 'dock';
    dock.innerHTML =
      '<div class="dock-list" role="menu" aria-label="Sections on this page">' +
      chapters.map((c, i) => '<button type="button" role="menuitem"><span>' + pad(i + 1) + '</span><span>' + c.getAttribute('data-chapter') + '</span></button>').join('') +
      '</div>' +
      '<button type="button" class="dock-pill" aria-expanded="false" aria-label="Sections on this page">' +
      '<span class="dock-idx">01</span><span class="dock-name"><span></span></span>' +
      '<span class="dock-ring" aria-hidden="true"><i></i><i></i></span></button>';
    document.body.appendChild(dock);

    const pill = $('.dock-pill', dock);
    const idx = $('.dock-idx', dock);
    const name = $('.dock-name', dock);
    const ring = $('.dock-ring', dock);
    const items = $$('.dock-list button', dock);

    const setOpen = (open) => {
      dock.classList.toggle('open', open);
      pill.setAttribute('aria-expanded', String(open));
    };
    pill.addEventListener('click', () => setOpen(!dock.classList.contains('open')));
    items.forEach((b, i) => b.addEventListener('click', () => { setOpen(false); scrollToEl(chapters[i]); }));
    document.addEventListener('click', (e) => { if (!dock.contains(e.target)) setOpen(false); });
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape') setOpen(false); });

    // Active = the last chapter whose top has passed the middle of the screen.
    // (Pinned panels keep top <= 0, so this works with the panel stack too.)
    let current = -1;
    onScroll((y) => {
      const vh = window.innerHeight;
      let at = 0;
      chapters.forEach((c, i) => { if (c.getBoundingClientRect().top <= vh * 0.5) at = i; });
      const max = Math.max(1, document.documentElement.scrollHeight - vh);
      ring.style.setProperty('--p', clamp(y / max, 0, 1).toFixed(4));
      if (at === current) return;
      current = at;
      idx.textContent = pad(at + 1);
      name.firstElementChild.textContent = chapters[at].getAttribute('data-chapter');
      name.classList.remove('swap');
      void name.offsetWidth;
      name.classList.add('swap');
      items.forEach((b, j) => b.classList.toggle('active', j === at));
    });
    queueScroll();
  }

  // --------------------------------------------
  // Custom cursor - dot + lagging ring + labels
  // --------------------------------------------
  function initCursor() {
    const dot = document.createElement('div');
    dot.className = 'cursor-dot';
    const ring = document.createElement('div');
    ring.className = 'cursor-ring';
    const label = document.createElement('span');
    label.className = 'cursor-label';
    ring.appendChild(label);
    const ambient = document.createElement('div');   // soft light trailing the cursor
    ambient.className = 'ambient';
    ambient.setAttribute('aria-hidden', 'true');
    document.body.append(ambient, dot, ring);

    const evaluate = () => {
      doc.classList.toggle('has-cursor', finePointer.matches && window.innerWidth > 860);
    };
    evaluate();
    window.addEventListener('resize', evaluate);
    if (finePointer.addEventListener) finePointer.addEventListener('change', evaluate);

    let mx = -100, my = -100, rx = -100, ry = -100, ax = -100, ay = -100;
    let seen = false;
    let raf = 0;
    function tick() {
      rx += (mx - rx) * 0.18;
      ry += (my - ry) * 0.18;
      ax += (mx - ax) * 0.06;
      ay += (my - ay) * 0.06;
      ring.style.transform = 'translate3d(' + rx.toFixed(2) + 'px,' + ry.toFixed(2) + 'px,0)';
      ambient.style.transform = 'translate3d(' + ax.toFixed(1) + 'px,' + ay.toFixed(1) + 'px,0)';
      raf = Math.abs(mx - ax) > 0.5 || Math.abs(my - ay) > 0.5 ? requestAnimationFrame(tick) : 0;
    }

    window.addEventListener('mousemove', (e) => {
      mx = e.clientX;
      my = e.clientY;
      if (!seen) {
        seen = true;
        rx = ax = mx; ry = ay = my;
        doc.classList.add('cursor-seen');
      }
      doc.classList.remove('cursor-out');
      dot.style.transform = 'translate3d(' + mx + 'px,' + my + 'px,0)';
      window.__cursor = { x: mx, y: my };
      if (!raf) raf = requestAnimationFrame(tick);
    }, { passive: true });
    doc.addEventListener('mouseleave', () => doc.classList.add('cursor-out'));

    const hoverables = 'a, button, [data-cursor], input, textarea, select, label, summary, [role="button"]';
    document.addEventListener('mouseover', (e) => {
      const t = e.target;
      if (!t || !t.closest) return;
      const labelled = t.closest('[data-cursor-label]');
      if (labelled) {
        label.textContent = labelled.getAttribute('data-cursor-label');
        ring.classList.add('has-label');
        ring.classList.remove('hover');
        return;
      }
      ring.classList.remove('has-label');
      ring.classList.toggle('hover', !!t.closest(hoverables));
    });
  }

  // --------------------------------------------
  // Text splitting
  // --------------------------------------------
  // textContent drops <br>s ("Not just<br/>a name" -> "Not justa name"), so
  // walk the nodes to build the screen-reader copy.
  function readableText(el) {
    let out = '';
    el.childNodes.forEach((node) => {
      if (node.nodeType === 3) out += node.nodeValue;
      else if (node.nodeName === 'BR') out += ' ';
      else if (node.nodeType === 1) out += readableText(node);
    });
    return out;
  }
  function textNodes(root) {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    const nodes = [];
    while (walker.nextNode()) nodes.push(walker.currentNode);
    return nodes;
  }

  // Per-letter blur-in. Keeps inner markup (.accent spans, <br>) and hides
  // the letter soup from screen readers behind an sr-only copy.
  function splitChars(el) {
    if ($('.split-vis', el)) return;
    const text = readableText(el).replace(/\s+/g, ' ').trim();
    if (!text) return;

    const vis = document.createElement('span');
    vis.className = 'split-vis';
    vis.setAttribute('aria-hidden', 'true');
    while (el.firstChild) vis.appendChild(el.firstChild);
    const sr = document.createElement('span');
    sr.className = 'sr-only';
    sr.textContent = text;
    el.append(sr, vis);

    let i = 0;
    textNodes(vis).forEach((node) => {
      const frag = document.createDocumentFragment();
      node.nodeValue.split(/(\s+)/).forEach((part) => {
        if (!part) return;
        if (/^\s+$/.test(part)) { frag.appendChild(document.createTextNode(' ')); return; }
        const w = document.createElement('span');
        w.className = 'w';
        for (const ch of part) {
          const c = document.createElement('span');
          c.className = 'ch';
          c.textContent = ch;
          c.style.setProperty('--y', ((Math.random() * 2 - 1) * 0.35).toFixed(3) + 'em');
          c.style.setProperty('--s', (0.55 + Math.random() * 1.1).toFixed(3));
          c.style.setProperty('--b', (6 + Math.random() * 10).toFixed(1) + 'px');
          c.style.setProperty('--cd', (Math.random() * 0.45 + i * 0.012).toFixed(3) + 's');
          w.appendChild(c);
          i++;
        }
        frag.appendChild(w);
      });
      node.parentNode.replaceChild(frag, node);
    });
  }
  function initSplit() {
    $$('[data-split]').forEach(splitChars);
  }

  // Words that light up as the paragraph scrolls through the viewport.
  function initLit() {
    const items = $$('[data-lit]').map((el) => {
      const words = [];
      textNodes(el).forEach((node) => {
        const frag = document.createDocumentFragment();
        node.nodeValue.split(/(\s+)/).forEach((part) => {
          if (!part) return;
          if (/^\s+$/.test(part)) { frag.appendChild(document.createTextNode(part)); return; }
          const s = document.createElement('span');
          s.className = 'lw';
          s.textContent = part;
          frag.appendChild(s);
          words.push(s);
        });
        node.parentNode.replaceChild(frag, node);
      });
      return { el, words, lit: -1 };
    });
    if (!items.length) return;
    if (reduceMotion) {
      items.forEach((it) => it.words.forEach((w) => w.classList.add('on')));
      return;
    }
    onScroll(() => {
      const vh = window.innerHeight;
      items.forEach((it) => {
        // Fully lit by the time the paragraph's top reaches ~45% of the screen -
        // i.e. while its panel is sliding in, before the next one covers it.
        const r = it.el.getBoundingClientRect();
        const start = vh * 0.95;
        const end = vh * 0.45;
        const p = clamp((start - r.top) / (start - end), 0, 1);
        const n = Math.round(p * it.words.length);
        if (n === it.lit) return;
        it.lit = n;
        it.words.forEach((w, i) => w.classList.toggle('on', i < n));
      });
    });
    queueScroll();
  }

  // --------------------------------------------
  // Reveal observer (+ count-up numbers)
  // --------------------------------------------
  const REVEAL_SEL = '.reveal, .kicker, [data-split], [data-count]';
  function countUp(el) {
    const raw = el.getAttribute('data-count');
    const end = parseFloat(raw);
    if (!isFinite(end)) return;
    const decimals = (raw.split('.')[1] || '').length;
    if (reduceMotion) { el.textContent = end.toFixed(decimals); return; }
    const t0 = performance.now();
    const dur = 1500;
    (function frame(now) {
      const p = clamp((now - t0) / dur, 0, 1);
      const eased = 1 - Math.pow(1 - p, 4);
      el.textContent = (end * eased).toFixed(decimals);
      if (p < 1) requestAnimationFrame(frame);
    })(t0);
  }
  function initReveals() {
    if (!('IntersectionObserver' in window)) return;
    doc.classList.add('reveal-on');

    const io = new IntersectionObserver((entries) => {
      entries.forEach((en) => {
        if (!en.isIntersecting) return;
        const el = en.target;
        el.classList.add('is-in');
        io.unobserve(el);
        if (el.hasAttribute('data-split')) setTimeout(() => el.classList.add('split-done'), 2400);
        if (el.hasAttribute('data-count')) countUp(el);
      });
    }, { rootMargin: '0px 0px -8% 0px', threshold: 0 });

    onReady(() => $$(REVEAL_SEL).forEach((el) => io.observe(el)));

    window.EV.observeReveals = (root) => {
      $$(REVEAL_SEL, root || document).forEach((el) => {
        if (!el.classList.contains('is-in')) io.observe(el);
      });
    };
  }

  // --------------------------------------------
  // Marquees - clone content until it can loop
  // seamlessly, speed in px/s via data-speed.
  // --------------------------------------------
  function initMarquees() {
    $$('[data-marquee]').forEach((m) => {
      const track = $('.marquee-track', m);
      const group = track && track.firstElementChild;
      if (!group) return;
      const original = group.innerHTML;
      let guard = 0;
      while (group.getBoundingClientRect().width < window.innerWidth * 1.1 && guard < 6) {
        group.insertAdjacentHTML('beforeend', original);
        guard++;
      }
      if (track.children.length < 2) {
        const clone = group.cloneNode(true);
        clone.setAttribute('aria-hidden', 'true');
        track.appendChild(clone);
      }
      const speed = parseFloat(m.getAttribute('data-speed')) || 70;
      const setDur = () => {
        const w = group.getBoundingClientRect().width;
        if (w > 0) track.style.setProperty('--dur', (w / speed).toFixed(2) + 's');
      };
      setDur();
      fontsReady(3000).then(setDur);
      window.addEventListener('resize', setDur);
    });
  }

  // --------------------------------------------
  // Warp field - stars streaming past behind every
  // hero. Scrolling pushes the throttle, and the
  // curtain lifting gives it one hard burn.
  // --------------------------------------------
  function initWarp() {
    $$('[data-warp]').forEach((host) => {
      const aurora = document.createElement('div');
      aurora.className = 'aurora';
      aurora.setAttribute('aria-hidden', 'true');
      aurora.innerHTML = '<i></i><i></i><i></i>';
      host.appendChild(aurora);
      const canvas = document.createElement('canvas');
      canvas.setAttribute('aria-hidden', 'true');
      host.appendChild(canvas);
      const ctx = canvas.getContext('2d');
      if (!ctx) return;

      const COUNT = window.innerWidth < 700 ? 150 : 300;
      const stars = [];
      const spawn = (s, anywhere) => {
        s.x = Math.random() * 2 - 1;
        s.y = Math.random() * 2 - 1;
        s.z = anywhere ? Math.random() * 0.95 + 0.05 : 1;
        s.tint = Math.random();
      };
      for (let i = 0; i < COUNT; i++) { const s = {}; spawn(s, true); stars.push(s); }

      let w = 0, h = 0, dpr = 1;
      const resize = () => {
        dpr = Math.min(window.devicePixelRatio || 1, 1.6);
        w = host.clientWidth;
        h = host.clientHeight;
        canvas.width = Math.max(1, Math.round(w * dpr));
        canvas.height = Math.max(1, Math.round(h * dpr));
      };
      resize();
      window.addEventListener('resize', resize);

      let boost = 0;
      let px = 0, py = 0, tx = 0, ty = 0;
      window.addEventListener('mousemove', (e) => {
        tx = e.clientX / window.innerWidth - 0.5;
        ty = e.clientY / window.innerHeight - 0.5;
      }, { passive: true });

      const draw = (speed) => {
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        ctx.clearRect(0, 0, w, h);
        const cx = w / 2 - px * 60;
        const cy = h * 0.48 - py * 40;
        const k = Math.max(w, h) * 0.62;
        ctx.lineCap = 'round';
        for (const s of stars) {
          const z0 = s.z;
          s.z -= speed;
          if (s.z <= 0.02) { spawn(s, false); continue; }
          const x1 = cx + (s.x / s.z) * k, y1 = cy + (s.y / s.z) * k;
          if (x1 < -40 || x1 > w + 40 || y1 < -40 || y1 > h + 40) { spawn(s, false); continue; }
          const zt = Math.min(1, z0 + speed * 3);
          const x0 = cx + (s.x / zt) * k, y0 = cy + (s.y / zt) * k;
          const near = 1 - s.z;
          ctx.strokeStyle = s.tint > 0.62
            ? 'rgba(180,165,255,' + (near * 0.9).toFixed(3) + ')'
            : 'rgba(243,240,234,' + (near * 0.7).toFixed(3) + ')';
          ctx.lineWidth = 0.4 + near * 1.5;
          ctx.beginPath();
          ctx.moveTo(x0, y0);
          ctx.lineTo(x1, y1);
          ctx.stroke();
        }
      };

      if (reduceMotion) { draw(0); return; }

      let visible = true;
      let running = false;
      const tick = () => {
        if (!visible || document.hidden) { running = false; return; }
        px += (tx - px) * 0.04;
        py += (ty - py) * 0.04;
        const v = lenis ? Math.abs(lenis.velocity || 0) : 0;
        boost = Math.max(boost * 0.955, Math.min(0.03, v * 0.0006));
        draw(0.0011 + boost);
        requestAnimationFrame(tick);
      };
      const start = () => { if (!running) { running = true; requestAnimationFrame(tick); } };
      if ('IntersectionObserver' in window) {
        new IntersectionObserver((entries) => {
          visible = entries[0].isIntersecting;
          if (visible) start();
        }).observe(host);
      }
      document.addEventListener('visibilitychange', () => { if (!document.hidden) start(); });
      draw(0);
      onReady(() => { boost = 0.05; start(); });
    });
  }

  // --------------------------------------------
  // Glow cards - borders light up near the cursor
  // --------------------------------------------
  function initGlow() {
    if (!finePointer.matches) return;
    let px = -9999, py = -9999;
    let queued = false;
    const update = () => {
      queued = false;
      const vh = window.innerHeight;
      $$('.glow').forEach((c) => {
        const r = c.getBoundingClientRect();
        if (r.bottom < -120 || r.top > vh + 120) return;
        const dx = Math.max(r.left - px, 0, px - r.right);
        const dy = Math.max(r.top - py, 0, py - r.bottom);
        const a = clamp(1 - Math.hypot(dx, dy) / 170, 0, 1);
        c.style.setProperty('--gx', (px - r.left).toFixed(1) + 'px');
        c.style.setProperty('--gy', (py - r.top).toFixed(1) + 'px');
        c.style.setProperty('--ga', a.toFixed(3));
      });
    };
    const queue = () => { if (!queued) { queued = true; requestAnimationFrame(update); } };
    window.addEventListener('pointermove', (e) => { px = e.clientX; py = e.clientY; queue(); }, { passive: true });
    onScroll(queue);
  }

  // --------------------------------------------
  // Small text toys: scramble on hover, flip words
  // --------------------------------------------
  const GLYPHS = '!<>-_\\/[]{}=+*^?#01';
  function scramble(el) {
    const final = el.getAttribute('data-text') || el.textContent;
    el.setAttribute('data-text', final);
    let frame = 0;
    const total = 14;
    clearInterval(el._sc);
    el._sc = setInterval(() => {
      frame++;
      const solved = (frame / total) * final.length;
      el.textContent = final.split('').map((ch, i) =>
        (ch === ' ' || i < solved) ? ch : GLYPHS[(Math.random() * GLYPHS.length) | 0]).join('');
      if (frame >= total) { clearInterval(el._sc); el.textContent = final; }
    }, 34);
  }
  function initScramble() {
    if (reduceMotion) return;
    $$('[data-scramble]').forEach((el) => {
      const host = el.closest('a, button') || el;
      host.addEventListener('mouseenter', () => scramble(el));
    });
  }
  function initFlip() {
    $$('[data-flip]').forEach((el) => {
      const words = (el.getAttribute('data-flip') || '').split('|').map((s) => s.trim()).filter(Boolean);
      if (words.length < 2) return;
      el.classList.add('flip');
      el.innerHTML = '<span></span>';
      const inner = el.firstElementChild;
      inner.textContent = words[0];
      if (reduceMotion) return;
      let i = 0;
      setInterval(() => {
        if (document.hidden) return;
        i = (i + 1) % words.length;
        el.classList.remove('in');
        el.classList.add('out');
        setTimeout(() => {
          inner.textContent = words[i];
          el.classList.remove('out');
          el.classList.add('in');
        }, 430);
      }, 2600);
    });
  }

  // --------------------------------------------
  // Hero: as you scroll away the content blurs and
  // lifts, title lines slide apart, the object grows.
  // Plus mouse tilt on anything with [data-tilt].
  // --------------------------------------------
  function initHeroFx() {
    const hero = $('.section.hero');
    if (hero && !reduceMotion) {
      const content = $('[data-hero-content]', hero) || $('.ph', hero) || $('.wrap', hero);
      const object = $('[data-hero-object]', hero);
      const lines = $$('.ph-title .line-mask', hero);
      onScroll((y) => {
        const h = hero.offsetHeight || window.innerHeight;
        const p = clamp(y / (h * 0.9), 0, 1);
        if (content) {
          content.style.opacity = clamp(1 - p * 1.2, 0, 1).toFixed(3);
          content.style.filter = p > 0.002 ? 'blur(' + (p * 14).toFixed(2) + 'px)' : '';
          content.style.translate = '0 ' + (-p * 70).toFixed(1) + 'px';
        }
        lines.forEach((line, i) => {
          line.style.translate = ((i % 2 ? 1 : -1) * p * 9).toFixed(2) + 'vw 0';
        });
        if (object) {
          object.style.scale = (1 + p * 1.5).toFixed(4);
          object.style.opacity = clamp(1 - p * 0.95, 0, 1).toFixed(3);
        }
      });
      queueScroll();
    }

    if (reduceMotion) return;
    $$('[data-tilt]').forEach((tilt) => {
      const zone = tilt.closest('[data-tilt-zone]') || tilt;
      const max = parseFloat(tilt.getAttribute('data-tilt')) || 14;
      zone.addEventListener('mousemove', (e) => {
        if (!finePointer.matches) return;
        const r = zone.getBoundingClientRect();
        const nx = (e.clientX - r.left) / r.width - 0.5;
        const ny = (e.clientY - r.top) / r.height - 0.5;
        tilt.style.setProperty('--ty', (nx * max * 2).toFixed(2) + 'deg');
        tilt.style.setProperty('--tx', (-ny * max * 1.6).toFixed(2) + 'deg');
      });
      zone.addEventListener('mouseleave', () => {
        tilt.style.setProperty('--tx', '0deg');
        tilt.style.setProperty('--ty', '0deg');
      });
    });
  }

  // --------------------------------------------
  // Scroll motion
  // 1. Scrub: big titles drift sideways, asides and
  //    tables float, screenshots grow as they cross
  //    the screen (CSS reads --p, 0 at the bottom
  //    edge of the screen, 1 at the top).
  // 2. Rows of a list get a staggered reveal.
  // 3. Velocity: marquees speed up while you scroll.
  // --------------------------------------------
  const SCRUB = [
    ['.sec-title', 'slide'],
    ['.sec-aside', 'rise'],
    ['.statement', 'rise'],
    ['.tbl-wrap', 'rise'],
    ['.shot', 'zoom'],
    ['.feature-visual > *', 'depth'],
  ];
  const STAGGER = ['.rows > .row-link', '.cmd-table > .cmd-row', '.pd-spec > .spec-row', '.log > *'];
  function initMotion() {
    STAGGER.forEach((sel) => {
      const seen = new Map();
      $$(sel).forEach((el) => {
        const n = seen.get(el.parentElement) || 0;
        seen.set(el.parentElement, n + 1);
        el.classList.add('reveal');
        if (n % 7) el.classList.add('d' + (n % 7));
      });
    });
    if (reduceMotion) return;

    const scrubbed = [];
    SCRUB.forEach(([sel, kind]) => $$(sel).forEach((el) => {
      if (el.hasAttribute('data-scrub')) return;
      el.setAttribute('data-scrub', kind);
      scrubbed.push(el);
    }));
    $$('[data-scrub]').forEach((el) => { if (!scrubbed.includes(el)) scrubbed.push(el); });
    if (scrubbed.length) {
      onScroll(() => {
        if (window.innerWidth <= 860) return;
        const vh = window.innerHeight;
        const rects = scrubbed.map((el) => el.getBoundingClientRect());   // reads first
        scrubbed.forEach((el, i) => {
          const r = rects[i];
          if (r.bottom < -80 || r.top > vh + 80) return;
          el.style.setProperty('--p', clamp((vh - r.top) / (vh + r.height), 0, 1).toFixed(4));
        });
      });
      queueScroll();
    }

    // Marquees lean into the scroll: faster while the page is moving.
    const tracks = $$('.marquee-track');
    if (tracks.length && lenis) {
      let running = false;
      const tick = () => {
        const v = Math.abs(lenis.velocity || 0);
        const rate = 1 + Math.min(7, v * 0.09);
        tracks.forEach((t) => {
          const anim = t.getAnimations ? t.getAnimations()[0] : null;
          if (anim) anim.playbackRate = rate;
        });
        if (v > 0.05) requestAnimationFrame(tick); else running = false;
      };
      onScroll(() => { if (!running) { running = true; requestAnimationFrame(tick); } });
    }
  }

  // --------------------------------------------
  // Page panels - each panel pins once its bottom
  // reaches the bottom of the screen; the next one
  // slides over it with a slanted lip while the
  // pinned one drifts up and fades.
  // --------------------------------------------
  function initPanels() {
    const root = $('.panels');
    if (!root) return;

    const pairs = [];    // { el, next, lip } - el gets covered by next
    const pinned = [];
    [root, ...$$('.panel-group', root)].forEach((parent) => {
      const kids = Array.from(parent.children).filter((c) => c.matches('.panel, .panel-group'));
      kids.forEach((el, i) => {
        el.style.zIndex = String(i + 1);
        pinned.push(el);
        const next = kids[i + 1];
        if (!next) return;
        let lip = null;
        if (!reduceMotion && next.matches('.panel')) {
          lip = document.createElement('div');
          lip.className = 'panel-lip';
          lip.setAttribute('aria-hidden', 'true');
          next.prepend(lip);
        }
        const inner = next.matches('.panel') ? next.querySelector(':scope > .wrap, :scope > .ph, :scope > .footer-inner') : null;
        pairs.push({ el, next, lip, inner, active: false });
      });
    });
    if (!pinned.length) return;
    doc.classList.add('panels-on');

    // top: min(0, 100vh - height) -> short panels pin at the top, tall ones
    // scroll normally until their bottom edge reaches the bottom of the screen.
    const measure = () => {
      const vh = window.innerHeight;
      pinned.forEach((el) => {
        const stick = Math.min(0, vh - el.offsetHeight);
        el.style.setProperty('--stick', stick + 'px');
        el.style.transformOrigin = '50% ' + Math.round(-stick + vh / 2) + 'px';
      });
    };
    let measureQueued = 0;
    const queueMeasure = () => {
      if (measureQueued) return;
      measureQueued = requestAnimationFrame(() => {
        measureQueued = 0;
        measure();
        queueScroll();
      });
    };
    measure();
    if ('ResizeObserver' in window) {
      const ro = new ResizeObserver(queueMeasure);
      pinned.forEach((el) => ro.observe(el));
    }
    window.addEventListener('resize', queueMeasure);
    fontsReady(4000).then(queueMeasure);

    onScroll(() => {
      const vh = window.innerHeight;
      const tops = pairs.map((p) => p.next.getBoundingClientRect().top);   // reads first
      pairs.forEach((p, i) => {
        // 0 = next panel still below the fold, 1 = it fully covers this one
        const t = clamp(1 - tops[i] / vh, 0, 1);
        if (!reduceMotion) {
          if (t > 0) {
            // the page being left shrinks into a rounded, outlined card and sinks back
            const radius = (t * 36).toFixed(1) + 'px';
            p.el.style.opacity = (1 - t * t).toFixed(3);
            p.el.style.translate = '0 ' + (-t * 9).toFixed(2) + 'vh';
            p.el.style.scale = (1 - t * 0.085).toFixed(4);
            p.el.style.borderRadius = radius;
            p.el.style.clipPath = 'inset(0 round ' + radius + ')';
            p.el.style.boxShadow = 'inset 0 0 0 1px rgba(220, 214, 255, ' + (t * 0.3).toFixed(3) + ')';
            p.active = true;
          } else if (p.active) {
            p.el.style.opacity = '';
            p.el.style.translate = '';
            p.el.style.scale = '';
            p.el.style.borderRadius = '';
            p.el.style.clipPath = '';
            p.el.style.boxShadow = '';
            p.active = false;
          }
          // ...while the incoming page's content rides in a little behind its edge
          if (p.inner) p.inner.style.transform = t > 0 && t < 1 ? 'translate3d(0,' + ((1 - t) * 110).toFixed(1) + 'px,0)' : '';
        }
        if (p.lip) {
          p.lip.style.transform = 'translate3d(0,' + (-t * 18).toFixed(2) + 'vh,0) skewY(' + (-t * 5).toFixed(3) + 'deg)';
        }
      });
    });
    queueScroll();
  }

  // --------------------------------------------
  // The name in a pill - fit to width; the footer
  // one rises in, and its stickers can be dragged
  // --------------------------------------------
  function initWordpills() {
    const items = $$('[data-fit]');
    if (!items.length) return;
    const fit = () => items.forEach((el) => {
      const box = el.closest('.wordpill') || el.parentElement;
      if (!box) return;
      el.style.fontSize = '100px';
      const w = el.getBoundingClientRect().width;
      const avail = box.clientWidth * 0.9;
      el.style.fontSize = '';
      if (!w || !avail) return;
      box.style.setProperty('--fm-size', Math.max(36, (100 * avail) / w).toFixed(2) + 'px');
    });
    fit();
    fontsReady(4000).then(fit);
    window.addEventListener('resize', fit);

    const risers = items.filter((el) => el.getAttribute('data-fit') === 'rise');
    if (risers.length && !reduceMotion) {
      onScroll(() => {
        const vh = window.innerHeight;
        risers.forEach((el) => {
          // 0 while the mark is still well below the fold, 1 once its bottom
          // edge reaches the bottom of the viewport (end of the page).
          const box = el.closest('.wordpill');
          const r = box.getBoundingClientRect();
          const lead = vh * 0.3;
          const p = clamp((vh + lead - r.top) / (r.height + lead), 0, 1);
          el.style.setProperty('--fm-shift', ((1 - p) * 60).toFixed(1) + '%');
        });
      });
      queueScroll();
    }

    $$('.wordpill .toss').forEach((el) => {
      let sx = 0, sy = 0, bl = 0, bt = 0, id = null;
      el.addEventListener('pointerdown', (e) => {
        const cs = getComputedStyle(el);
        bl = el.offsetLeft - parseFloat(cs.marginLeft);
        bt = el.offsetTop - parseFloat(cs.marginTop);
        sx = e.clientX; sy = e.clientY; id = e.pointerId;
        el.setPointerCapture(id);
        el.classList.add('dragging');
        e.preventDefault();
      });
      el.addEventListener('pointermove', (e) => {
        if (e.pointerId !== id) return;
        el.style.left = (bl + e.clientX - sx) + 'px';
        el.style.top = (bt + e.clientY - sy) + 'px';
      });
      const drop = (e) => {
        if (e.pointerId !== id) return;
        id = null;
        el.classList.remove('dragging');
      };
      el.addEventListener('pointerup', drop);
      el.addEventListener('pointercancel', drop);
    });
  }

  // --------------------------------------------
  // Magnetic buttons
  // --------------------------------------------
  function initMagnetic() {
    if (reduceMotion) return;
    $$('[data-magnetic]').forEach((el) => {
      const k = parseFloat(el.getAttribute('data-magnetic')) || 0.28;
      el.addEventListener('mousemove', (e) => {
        if (!finePointer.matches) return;
        const r = el.getBoundingClientRect();
        const x = (e.clientX - r.left - r.width / 2) * k;
        const y = (e.clientY - r.top - r.height / 2) * k;
        el.style.translate = x.toFixed(1) + 'px ' + y.toFixed(1) + 'px';
      });
      el.addEventListener('mouseleave', () => { el.style.translate = ''; });
    });
  }

  function initTopbar() {
    const bar = $('.topbar');
    if (!bar) return;
    onScroll((y) => bar.classList.toggle('is-scrolled', y > 24));
    queueScroll();
  }

  // Flip cards: [data-flipcard] turns over on click (or Enter / Space),
  // except when the click lands on a link or button inside it.
  function initFlipCards() {
    $$('[data-flipcard]').forEach((card) => {
      const flip = () => {
        const on = card.classList.toggle('flipped');
        card.setAttribute('aria-pressed', String(on));
        sfx('click');
      };
      card.addEventListener('click', (e) => {
        if (e.target.closest && e.target.closest('a, button')) return;
        flip();
      });
      card.addEventListener('keydown', (e) => {
        if (e.target !== card) return;
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); flip(); }
      });
    });
  }

  function initCopy() {
    $$('[data-print]').forEach((btn) => btn.addEventListener('click', () => window.print()));
    $$('[data-copy]').forEach((btn) => {
      const label = $('[data-copy-label]', btn) || btn;
      const idle = label.textContent;
      btn.addEventListener('click', async () => {
        try {
          await navigator.clipboard.writeText(btn.getAttribute('data-copy'));
          label.textContent = 'Copied';
        } catch (err) {
          label.textContent = 'Press Ctrl+C';
        }
        setTimeout(() => { label.textContent = idle; }, 1400);
      });
    });
  }

  function initYearStamps() {
    const year = String(new Date().getFullYear());
    $$('[data-year]').forEach((el) => { el.textContent = year; });
  }

  // --------------------------------------------
  // Sound - off by default. Tiny synthesised blips
  // (no audio files), toggled from the top bar.
  // --------------------------------------------
  let audio = null;
  let soundOn = false;
  try { soundOn = localStorage.getItem('evz-sound') === '1'; } catch (err) { /* storage blocked */ }
  function tone(o) {
    const t = audio.currentTime + (o.delay || 0);
    const osc = audio.createOscillator();
    const gain = audio.createGain();
    osc.type = o.type || 'sine';
    osc.frequency.setValueAtTime(o.from, t);
    if (o.to) osc.frequency.exponentialRampToValueAtTime(o.to, t + o.dur);
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(o.vol, t + 0.012);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + o.dur);
    osc.connect(gain).connect(audio.destination);
    osc.start(t);
    osc.stop(t + o.dur + 0.03);
  }
  const SFX = {
    tick:  () => tone({ from: 1900, to: 1500, dur: 0.045, vol: 0.016 }),
    click: () => tone({ type: 'triangle', from: 520, to: 240, dur: 0.09, vol: 0.05 }),
    open:  () => {
      tone({ from: 320, to: 760, dur: 0.22, vol: 0.04 });
      tone({ from: 640, to: 1280, dur: 0.26, vol: 0.02, delay: 0.05 });
    },
    close: () => tone({ from: 700, to: 300, dur: 0.2, vol: 0.035 }),
    meow:  () => {   // "me" rises, "ow" falls, through a filter that opens and closes like a mouth
      const t = audio.currentTime;
      const osc = audio.createOscillator();
      const mouth = audio.createBiquadFilter();
      const gain = audio.createGain();
      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(520, t);
      osc.frequency.linearRampToValueAtTime(860, t + 0.14);
      osc.frequency.linearRampToValueAtTime(600, t + 0.42);
      mouth.type = 'bandpass';
      mouth.Q.value = 5;
      mouth.frequency.setValueAtTime(900, t);
      mouth.frequency.linearRampToValueAtTime(2300, t + 0.16);
      mouth.frequency.linearRampToValueAtTime(1100, t + 0.42);
      gain.gain.setValueAtTime(0.0001, t);
      gain.gain.exponentialRampToValueAtTime(0.09, t + 0.05);
      gain.gain.setValueAtTime(0.09, t + 0.3);
      gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.46);
      osc.connect(mouth).connect(gain).connect(audio.destination);
      osc.start(t);
      osc.stop(t + 0.5);
    },
  };
  function sfx(name) {
    if (!soundOn || !SFX[name]) return;
    try {
      if (!audio) audio = new (window.AudioContext || window.webkitAudioContext)();
      if (audio.state === 'suspended') audio.resume();
      SFX[name]();
    } catch (err) { /* no audio on this device */ }
  }
  function setSound(on) {
    soundOn = on;
    try { localStorage.setItem('evz-sound', on ? '1' : '0'); } catch (err) { /* storage blocked */ }
    doc.classList.toggle('sound-on', on);
    $$('.sound-btn').forEach((b) => {
      b.setAttribute('aria-pressed', String(on));
      b.setAttribute('aria-label', on ? 'Turn sound off' : 'Turn sound on');
    });
    if (on) sfx('open');
  }
  function initSound() {
    doc.classList.toggle('sound-on', soundOn);
    $$('.sound-btn').forEach((b) => {
      b.setAttribute('aria-pressed', String(soundOn));
      b.setAttribute('aria-label', soundOn ? 'Turn sound off' : 'Turn sound on');
      b.addEventListener('click', () => setSound(!soundOn));
    });
    const hot = 'a, button, [role="button"]';
    let last = null;
    let lastAt = 0;
    document.addEventListener('mouseover', (e) => {
      if (!soundOn) return;
      const el = e.target.closest && e.target.closest(hot);
      if (!el) { last = null; return; }
      const now = performance.now();
      if (el === last || now - lastAt < 70) return;
      last = el;
      lastAt = now;
      sfx('tick');
    });
    document.addEventListener('pointerdown', (e) => {
      if (soundOn && e.target.closest && e.target.closest(hot)) sfx('click');
    });
  }

  // --------------------------------------------
  // Command palette (Ctrl / Cmd + K) - type to
  // jump to a page or a project, or run a small
  // action.
  // --------------------------------------------
  let paletteEl = null;
  function initPalette() {
    const EMAIL = 'r@evzero.org';
    const here = document.body.getAttribute('data-page') || '';
    const go = (href) => () => {
      const url = new URL(ROOT + href, location.href);
      if (url.pathname !== location.pathname) { leave(url.href); return; }
      // already on that page: a hash means "open this", otherwise just go back up
      if (url.hash) { location.hash = url.hash; location.reload(); } else scrollToTop();
    };
    const ITEMS = [
      { group: 'Pages', label: 'Home', hint: 'start here', stk: 'home', key: 'home', run: go('') },
      { group: 'Pages', label: 'Work', hint: 'all ten projects', stk: 'work', key: 'work', run: go('projects/') },
      { group: 'Pages', label: 'Say hi', hint: 'contact', stk: 'contact', key: 'contact', words: 'email discord message', run: go('contact/') },
      { group: 'Pages', label: 'Résumé', hint: 'one page, printable', stk: 'resume', key: 'resume', words: 'resume cv hire internship', run: go('resume/') },
      { group: 'Projects', label: 'AiS', hint: 'anti-cheat for AI agents', stk: 'ais', key: 'ais', words: 'sandbox security agent', run: go('ais/') },
      { group: 'Projects', label: 'Spice', hint: 'overlay for gamers', stk: 'spice', key: 'spice', words: 'crosshair overlay', run: go('spice/') },
      { group: 'Projects', label: 'Qres', hint: 'one key, new resolution', stk: 'qres', key: 'qres', words: 'stretched resolution hotkey', run: go('qres/') },
      { group: 'Projects', label: 'clipped', hint: 'Twitch clips to YouTube Shorts', stk: 'clipped', key: 'clipped', words: 'shorts youtube twitch clips captions autopilot', run: go('clipped/') },
      { group: 'Projects', label: 'Get clipped', hint: '$2.99 a month or $32 for life', stk: 'clipped', words: 'buy price licence key lifetime monthly', run: go('clipped/buy/') },
      { group: 'Projects', label: 'Watchparty', hint: 'same frame, two couches', stk: 'watchparty', key: 'watchparty', words: 'watch together youtube twitch netflix', run: go('watchparty/') },
      { group: 'Projects', label: 'Pixel cat', hint: 'the one stalking your cursor', stk: 'cat', words: 'cat pet', run: go('projects/#pixel-cat') },
      { group: 'Projects', label: 'Valorant tracker', hint: 'outdated', stk: 'tracker', key: 'tracker', words: 'val rank', run: go('valorant/') },
      { group: 'Actions', label: 'Copy my email address', hint: EMAIL, icon: '@', words: 'mail contact', keep: true,
        run: (it) => navigator.clipboard.writeText(EMAIL).then(() => flash(it, 'Copied'), () => flash(it, EMAIL)) },
      { group: 'Actions', label: 'Open the Discord server', hint: 'new tab', icon: '↗', words: 'chat', run: () => window.open('https://discord.gg/hrN8ye6nrF', '_blank', 'noopener') },
      { group: 'Actions', label: 'Open GitHub', hint: 'new tab', icon: '↗', words: 'source code repo', run: () => window.open('https://github.com/ritviksajeev', '_blank', 'noopener') },
      { group: 'Actions', label: 'Toggle sound', hint: 'clicks and a meow', icon: '♪', words: 'audio mute volume', keep: true,
        run: (it) => { setSound(!soundOn); flash(it, soundOn ? 'Sound on' : 'Sound off'); } },
      { group: 'Actions', label: 'Pet the cat', hint: 'it likes that', icon: '♥', words: 'meow', run: () => window.dispatchEvent(new Event('evz:pet')) },
      { group: 'Actions', label: 'Back to the top', hint: 'of this page', icon: '↑', words: 'scroll up', run: () => scrollToTop() },
      { group: 'Actions', label: 'Replay the intro', hint: 'evzero, then welcome', icon: '↻', words: 'welcome loader curtain',
        run: () => { try { sessionStorage.removeItem('evz-welcomed'); } catch (err) { /* fine */ } window.location.href = new URL(ROOT || './', location.href).href; } },
    ];

    paletteEl = document.createElement('div');
    paletteEl.className = 'palette';
    paletteEl.setAttribute('role', 'dialog');
    paletteEl.setAttribute('aria-modal', 'true');
    paletteEl.setAttribute('aria-label', 'Command palette');
    paletteEl.setAttribute('aria-hidden', 'true');
    paletteEl.innerHTML =
      '<div class="palette-backdrop"></div>' +
      '<div class="palette-box">' +
      '<div class="palette-top"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="M20 20l-3.6-3.6"/></svg>' +
      '<input class="palette-input" type="text" placeholder="Where to? Try “ais”, “résumé” or “cat”" autocomplete="off" spellcheck="false" aria-label="Search pages, projects and actions"/>' +
      '<kbd>Esc</kbd></div>' +
      '<div class="palette-list" role="listbox" data-lenis-prevent></div>' +
      '<div class="palette-foot"><span><kbd>↑</kbd><kbd>↓</kbd> move</span><span><kbd>↵</kbd> open</span><span><kbd>Esc</kbd> close</span></div>' +
      '</div>';
    document.body.appendChild(paletteEl);

    const input = $('.palette-input', paletteEl);
    const list = $('.palette-list', paletteEl);
    let shown = [];
    let active = 0;
    let lastFocus = null;

    function flash(it, text) {
      const row = list.children[shown.indexOf(it) + groupOffset(shown.indexOf(it))];
      const hint = row && $('.palette-hint', row);
      if (hint) hint.textContent = text;
      setTimeout(closePalette, 650);
    }
    // rows and group headings share the list, so a row's DOM index is its
    // item index plus the number of headings above it
    function groupOffset(index) {
      let n = 0;
      let g = null;
      for (let i = 0; i <= index; i++) { if (shown[i].group !== g) { g = shown[i].group; n++; } }
      return n;
    }
    function matches(it, q) {
      if (!q) return true;
      const hay = (it.label + ' ' + (it.hint || '') + ' ' + (it.words || '')).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
      return q.split(/\s+/).every((part) => hay.includes(part));
    }
    function render() {
      const q = input.value.trim().toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
      shown = ITEMS.filter((it) => matches(it, q));
      active = clamp(active, 0, Math.max(0, shown.length - 1));
      let html = '';
      let group = null;
      shown.forEach((it, i) => {
        if (it.group !== group) { group = it.group; html += '<div class="palette-group">' + group + '</div>'; }
        html += '<button type="button" class="palette-item' + (i === active ? ' active' : '') + '" role="option" data-i="' + i + '" aria-selected="' + (i === active) + '">' +
          '<span class="palette-ico">' + (it.stk ? sticker(it.stk) : '<i>' + it.icon + '</i>') + '</span>' +
          '<span class="palette-label">' + it.label + (it.key && it.key === here ? '<em>you are here</em>' : '') + '</span>' +
          '<span class="palette-hint">' + (it.hint || '') + '</span></button>';
      });
      list.innerHTML = html || '<div class="palette-empty">Nothing matches that. Try “work” or “cat”.</div>';
      const row = $('.palette-item.active', list);
      if (row) row.scrollIntoView({ block: 'nearest' });
    }
    function runActive() {
      const it = shown[active];
      if (!it) return;
      sfx('click');
      if (!it.keep) closePalette();
      it.run(it);
    }
    function openPalette() {
      if (doc.classList.contains('palette-open')) return;
      closeMenu();
      lastFocus = document.activeElement;
      input.value = '';
      active = 0;
      render();
      doc.classList.add('palette-open');
      paletteEl.setAttribute('aria-hidden', 'false');
      lockScroll();
      sfx('open');
      setTimeout(() => input.focus({ preventScroll: true }), 60);
    }
    function closePalette() {
      if (!doc.classList.contains('palette-open')) return;
      doc.classList.remove('palette-open');
      paletteEl.setAttribute('aria-hidden', 'true');
      unlockScroll();
      if (lastFocus && typeof lastFocus.focus === 'function') lastFocus.focus({ preventScroll: true });
    }
    window.EV.palette = openPalette;

    input.addEventListener('input', () => { active = 0; render(); });
    list.addEventListener('mousemove', (e) => {
      const row = e.target.closest && e.target.closest('.palette-item');
      if (!row) return;
      const i = Number(row.getAttribute('data-i'));
      if (i === active) return;
      active = i;
      $$('.palette-item', list).forEach((r) => {
        const on = Number(r.getAttribute('data-i')) === active;
        r.classList.toggle('active', on);
        r.setAttribute('aria-selected', String(on));
      });
    });
    list.addEventListener('click', (e) => {
      const row = e.target.closest && e.target.closest('.palette-item');
      if (!row) return;
      active = Number(row.getAttribute('data-i'));
      runActive();
    });
    $('.palette-backdrop', paletteEl).addEventListener('click', closePalette);
    $$('.palette-btn').forEach((b) => {
      const k = $('kbd', b);
      if (k && /Mac|iPhone|iPad/.test(navigator.platform || '')) k.textContent = '⌘K';
      b.addEventListener('click', openPalette);
    });
    document.addEventListener('keydown', (e) => {
      if ((e.ctrlKey || e.metaKey) && !e.altKey && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        if (doc.classList.contains('palette-open')) closePalette(); else openPalette();
        return;
      }
      if (!doc.classList.contains('palette-open')) return;
      if (e.key === 'Escape') { e.preventDefault(); closePalette(); }
      else if (e.key === 'ArrowDown') { e.preventDefault(); active = (active + 1) % Math.max(1, shown.length); render(); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); active = (active - 1 + shown.length) % Math.max(1, shown.length); render(); }
      else if (e.key === 'Enter') { e.preventDefault(); runActive(); }
    });
  }

  // --------------------------------------------
  // Build log - the latest commits across the
  // public repos, straight from GitHub's API
  // (cached for 20 minutes per visitor).
  // --------------------------------------------
  function initBuildLog() {
    const host = $('[data-buildlog]');
    if (!host) return;
    const REPOS = ['ais', 'spice', 'Qres', 'clipped', 'ev'];
    const SKIP = /^merge |\bwip\b|private|seal|solren/i;   // housekeeping commits nobody needs to read
    const KEY = 'evz-buildlog-v2';
    const TTL = 20 * 60 * 1000;

    const ago = (iso) => {
      const days = Math.floor((Date.now() - new Date(iso).getTime()) / 86400000);
      if (days < 1) return 'today';
      if (days < 2) return 'yesterday';
      if (days < 14) return days + 'd ago';
      if (days < 60) return Math.floor(days / 7) + 'w ago';
      if (days < 365) return Math.floor(days / 30) + 'mo ago';
      return Math.floor(days / 365) + 'y ago';
    };
    const esc = (t) => String(t).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
    const render = (rows) => {
      host.innerHTML = rows.map((r) =>
        '<a class="log-row" href="' + esc(r.url) + '" target="_blank" rel="noreferrer noopener">' +
        '<span class="log-repo">' + esc(r.repo) + '</span>' +
        '<span class="log-msg">' + esc(r.msg) + '</span>' +
        '<span class="log-sha">' + esc(r.sha) + '</span>' +
        '<span class="log-time">' + ago(r.date) + '</span></a>').join('');
      host.classList.add('is-live');
      $$('.log-row', host).forEach((el, i) => { el.classList.add('reveal'); if (i) el.classList.add('d' + Math.min(i, 7)); });
      if (window.EV.observeReveals) window.EV.observeReveals(host);
    };
    const fail = () => {
      host.innerHTML = '<div class="log-empty">GitHub is not answering right now. The commits are all on <a href="https://github.com/ritviksajeev" target="_blank" rel="noreferrer noopener">github.com/ritviksajeev</a>.</div>';
    };

    let cached = null;
    try { cached = JSON.parse(localStorage.getItem(KEY) || 'null'); } catch (err) { /* ignore */ }
    if (cached && cached.rows && Date.now() - cached.at < TTL) { render(cached.rows); return; }

    Promise.all(REPOS.map((repo) =>
      fetch('https://api.github.com/repos/ritviksajeev/' + repo + '/commits?per_page=6', { headers: { Accept: 'application/vnd.github+json' } })
        .then((res) => (res.ok ? res.json() : []))
        .then((list) => (Array.isArray(list) ? list : []).map((c) => ({
          repo,
          msg: String(c.commit.message).split('\n')[0],
          date: c.commit.author.date,
          url: c.html_url,
          sha: c.sha.slice(0, 7),
        })).filter((r) => !SKIP.test(r.msg)).slice(0, 2))   // two per repo keeps the list varied
        .catch(() => [])
    )).then((groups) => {
      const rows = [].concat(...groups)
        .sort((a, b) => new Date(b.date) - new Date(a.date))
        .slice(0, 6);
      if (!rows.length) { if (cached && cached.rows) render(cached.rows); else fail(); return; }
      try { localStorage.setItem(KEY, JSON.stringify({ at: Date.now(), rows })); } catch (err) { /* storage blocked */ }
      render(rows);
    });
  }

  // --------------------------------------------
  // Boot
  // --------------------------------------------
  window.EV = window.EV || {};
  window.EV.onReady = onReady;
  window.EV.onScroll = onScroll;
  window.EV.scrollTo = scrollToEl;
  window.EV.lock = lockScroll;
  window.EV.unlock = unlockScroll;
  window.EV.sticker = sticker;
  window.EV.sfx = sfx;
  window.EV.stickers = initStickers;
  window.EV.root = ROOT;
  Object.defineProperty(window.EV, 'lenis', { get: () => lenis, configurable: true });

  function boot() {
    safe('smooth-scroll', initSmoothScroll);
    safe('cursor', initCursor);
    safe('stickers', initStickers);
    safe('menu', initMenu);
    safe('transitions', initTransitions);
    safe('split', initSplit);
    safe('lit', initLit);
    safe('marquee', initMarquees);
    safe('panels', initPanels);
    safe('motion', initMotion);     // before reveals: it tags list rows for them
    safe('reveals', initReveals);
    safe('hero', initHeroFx);
    safe('warp', initWarp);
    safe('dock', initDock);
    safe('wordpills', initWordpills);
    safe('glow', initGlow);
    safe('scramble', initScramble);
    safe('flip', initFlip);
    safe('magnetic', initMagnetic);
    safe('topbar', initTopbar);
    safe('copy', initCopy);
    safe('flipcards', initFlipCards);
    safe('sound', initSound);
    safe('palette', initPalette);
    safe('buildlog', initBuildLog);
    safe('year', initYearStamps);
    safe('loader', initLoader);   // last - it flips the page to ready
    // the cat boots itself from cat.js
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
