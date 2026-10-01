/* ============================================
   EvZero - Common JS (v2)
   Loader + page curtain, Lenis smooth scroll,
   custom cursor, menu overlay, reveal system
   (split letters / lit words), marquees, hero +
   stacked-card scroll effects, footer wordmark.
   ============================================ */

(function () {
  'use strict';

  const doc = document.documentElement;
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const finePointer = window.matchMedia('(hover: hover) and (pointer: fine)');

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
  // until the loader / curtain lifts.
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
      lerp: 0.1,
      smoothWheel: true,
      allowNestedScroll: true,
    });
  }

  // Scroll lock for the menu / modals. Locks <html> (never <body>, which would
  // become its own scroll container and un-pin the panels) and pauses Lenis.
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
  // Loader (first visit per session) / curtain
  // --------------------------------------------
  function initLoader() {
    const loader = $('.loader');
    const firstVisit = doc.classList.contains('first-visit');
    try { sessionStorage.setItem('evz-visited', '1'); } catch (err) { /* private mode */ }

    if (!loader) { markReady(); return; }

    // Repeat visit: short curtain, lift once fonts are in (capped).
    if (!firstVisit || reduceMotion) {
      fontsReady(650).then(() => setTimeout(markReady, 80));
      setTimeout(markReady, 1500);
      return;
    }

    // First visit: count 0 -> 100 (12.studio), tied to real load events but
    // never faster than MIN and never longer than MAX.
    const num = $('[data-loader-num]', loader);
    const numWrap = num ? num.parentElement : null;
    const bar = $('[data-loader-bar]', loader);
    const MIN = 1700;
    const MAX = 5000;
    const t0 = performance.now();
    let target = 8;
    let shown = 0;
    let done = false;
    const bump = (v) => { target = Math.max(target, v); };

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => bump(35));
    else bump(35);
    fontsReady(4000).then(() => bump(72));
    if (document.readyState === 'complete') bump(100);
    else window.addEventListener('load', () => bump(100));

    setTimeout(() => loader.classList.add('is-counting'), 260);

    function render(v) {
      if (num) num.textContent = String(Math.round(v));
      if (numWrap) numWrap.style.opacity = (0.18 + 0.82 * (v / 100)).toFixed(3);
      if (bar) bar.style.transform = 'scaleX(' + (v / 100).toFixed(4) + ')';
    }
    function finish() {
      if (done) return;
      done = true;
      render(100);
      setTimeout(() => {
        loader.classList.add('is-done');
        setTimeout(markReady, 420);
      }, 240);
    }
    function frame(now) {
      if (done) return;
      const elapsed = now - t0;
      let goal = Math.min(target, elapsed < MIN ? (elapsed / MIN) * 100 : 100);
      if (elapsed > MAX) goal = 100;
      shown += (goal - shown) * 0.09;
      if (goal - shown < 0.5) shown = goal;
      render(shown);
      if (shown >= 100) finish(); else requestAnimationFrame(frame);
    }
    requestAnimationFrame(frame);
    // rAF pauses in background tabs - make sure we always finish.
    setTimeout(finish, 6000);
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
    closeMenu();
    doc.classList.add('is-leaving');
    setTimeout(() => { window.location.href = href; }, reduceMotion ? 0 : 680);
  }

  // --------------------------------------------
  // Menu overlay (12.studio) - built from the nav
  // --------------------------------------------
  let menuBtn = null;
  let menuEl = null;
  function initMenu() {
    const nav = $('.nav');
    const links = $$('.nav-links a');
    if (!nav || !links.length) return;

    const right = $('.nav-right', nav) || $('.nav-inner', nav) || nav;
    menuBtn = document.createElement('button');
    menuBtn.type = 'button';
    menuBtn.className = 'nav-menu';
    menuBtn.setAttribute('aria-expanded', 'false');
    menuBtn.setAttribute('aria-controls', 'site-menu');
    menuBtn.innerHTML = '<span class="nav-menu-label">Menu</span><span class="burger" aria-hidden="true"></span>';
    right.appendChild(menuBtn);

    menuEl = document.createElement('div');
    menuEl.className = 'menu';
    menuEl.id = 'site-menu';
    menuEl.setAttribute('aria-hidden', 'true');
    menuEl.setAttribute('data-lenis-prevent', '');

    const list = document.createElement('nav');
    list.className = 'menu-links';
    list.setAttribute('aria-label', 'Menu');
    links.forEach((src, i) => {
      const a = document.createElement('a');
      a.href = src.getAttribute('href');
      a.setAttribute('data-transition', '');
      if (src.classList.contains('active')) a.classList.add('active');
      a.style.setProperty('--i', String(i));
      const t = document.createElement('span');
      t.className = 'mt';
      t.textContent = ($('.nl', src) || src).textContent.trim();
      const n = document.createElement('span');
      n.className = 'mi';
      n.textContent = '(' + String(i + 1).padStart(2, '0') + ')';
      a.append(t, n);
      list.appendChild(a);
    });
    menuEl.appendChild(list);

    const foot = document.createElement('div');
    foot.className = 'menu-foot';
    const mail = $('.footer-mail');
    if (mail) {
      const m = document.createElement('a');
      m.href = mail.getAttribute('href');
      m.textContent = mail.textContent.trim();
      foot.appendChild(m);
    }
    const socials = $$('.footer-socials a');
    if (socials.length) {
      const row = document.createElement('div');
      row.className = 'menu-socials';
      socials.forEach((s) => row.appendChild(s.cloneNode(true)));
      foot.appendChild(row);
    }
    menuEl.appendChild(foot);
    document.body.appendChild(menuEl);

    menuBtn.addEventListener('click', () => toggleMenu());
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && doc.classList.contains('menu-open')) {
        closeMenu();
        menuBtn.focus();
      }
    });
    window.addEventListener('resize', () => {
      if (window.innerWidth > 860) closeMenu();
    });
  }
  function toggleMenu(force) {
    if (!menuBtn) return;
    const open = typeof force === 'boolean' ? force : !doc.classList.contains('menu-open');
    doc.classList.toggle('menu-open', open);
    menuBtn.setAttribute('aria-expanded', String(open));
    const label = $('.nav-menu-label', menuBtn);
    if (label) label.textContent = open ? 'Close' : 'Menu';
    if (menuEl) menuEl.setAttribute('aria-hidden', String(!open));
    applyLock();
    if (open) {
      const first = menuEl && $('a', menuEl);
      if (first) setTimeout(() => first.focus({ preventScroll: true }), 450);
    }
  }
  function closeMenu() {
    if (doc.classList.contains('menu-open')) toggleMenu(false);
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
    document.body.append(dot, ring);

    const evaluate = () => {
      doc.classList.toggle('has-cursor', finePointer.matches && window.innerWidth > 860);
    };
    evaluate();
    window.addEventListener('resize', evaluate);
    if (finePointer.addEventListener) finePointer.addEventListener('change', evaluate);

    let mx = -100, my = -100, rx = -100, ry = -100;
    let seen = false;
    let raf = 0;
    function tick() {
      rx += (mx - rx) * 0.18;
      ry += (my - ry) * 0.18;
      ring.style.transform = 'translate3d(' + rx.toFixed(2) + 'px,' + ry.toFixed(2) + 'px,0)';
      raf = Math.abs(mx - rx) > 0.1 || Math.abs(my - ry) > 0.1 ? requestAnimationFrame(tick) : 0;
    }

    window.addEventListener('mousemove', (e) => {
      mx = e.clientX;
      my = e.clientY;
      if (!seen) {
        seen = true;
        rx = mx; ry = my;
        doc.classList.add('cursor-seen');
      }
      doc.classList.remove('cursor-out');
      dot.style.transform = 'translate3d(' + mx + 'px,' + my + 'px,0)';
      window.__cursor = { x: mx, y: my };
      if (!raf) raf = requestAnimationFrame(tick);
    }, { passive: true });
    doc.addEventListener('mouseleave', () => doc.classList.add('cursor-out'));

    const hoverables = 'a, button, [data-cursor], input, textarea, select, label, summary, .project-card';
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

  // Per-letter blur-in (12.studio). Keeps inner markup (.accent spans, <br>)
  // and hides the letter soup from screen readers behind an sr-only copy.
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

  // Words that light up as the paragraph scrolls through the viewport (Fuel).
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
  // Reveal observer
  // --------------------------------------------
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
      });
    }, { rootMargin: '0px 0px -8% 0px', threshold: 0 });

    // Legacy hook: sections get .is-active once they've been seen.
    const sio = new IntersectionObserver((entries) => {
      entries.forEach((en) => {
        if (en.isIntersecting) { en.target.classList.add('is-active'); sio.unobserve(en.target); }
      });
    }, { rootMargin: '0px 0px -15% 0px', threshold: 0 });

    onReady(() => {
      $$('.reveal, .sec-bar, [data-split]').forEach((el) => io.observe(el));
      $$('.section').forEach((s) => sio.observe(s));
    });

    window.EV.observeReveals = (root) => {
      $$('.reveal, .sec-bar, [data-split]', root || document).forEach((el) => {
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
  // Hero: blur/fade text + grow object on scroll,
  // mouse tilt on the glass cube (12.studio)
  // --------------------------------------------
  function initHeroFx() {
    const hero = $('[data-hero-fx]');
    if (!hero) return;
    const content = $('[data-hero-content]', hero);
    const object = $('[data-hero-object]', hero);

    if (!reduceMotion) {
      onScroll((y) => {
        const h = hero.offsetHeight || window.innerHeight;
        const p = clamp(y / (h * 0.9), 0, 1);
        if (content) {
          content.style.opacity = clamp(1 - p * 1.2, 0, 1).toFixed(3);
          content.style.filter = p > 0.002 ? 'blur(' + (p * 14).toFixed(2) + 'px)' : '';
          content.style.translate = '0 ' + (-p * 70).toFixed(1) + 'px';
        }
        if (object) {
          object.style.scale = (1 + p * 1.5).toFixed(4);
          object.style.opacity = clamp(1 - p * 0.95, 0, 1).toFixed(3);
        }
      });
      queueScroll();
    }

    const tilt = $('[data-tilt]', hero);
    if (tilt && !reduceMotion) {
      hero.addEventListener('mousemove', (e) => {
        if (!finePointer.matches) return;
        const r = hero.getBoundingClientRect();
        const nx = (e.clientX - r.left) / r.width - 0.5;
        const ny = (e.clientY - r.top) / r.height - 0.5;
        tilt.style.setProperty('--ty', (nx * 30).toFixed(2) + 'deg');
        tilt.style.setProperty('--tx', (-ny * 24).toFixed(2) + 'deg');
      });
      hero.addEventListener('mouseleave', () => {
        tilt.style.setProperty('--tx', '0deg');
        tilt.style.setProperty('--ty', '0deg');
      });
    }
  }

  // --------------------------------------------
  // Page panels (Fuel) - each panel pins once its
  // bottom reaches the bottom of the screen; the
  // next one slides over it with a slanted lip
  // while the pinned one drifts up and fades.
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
        pairs.push({ el, next, lip, active: false });
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
            p.el.style.opacity = (1 - t).toFixed(3);
            p.el.style.translate = '0 ' + (-t * 10).toFixed(2) + 'vh';
            p.el.style.scale = (1 - t * 0.05).toFixed(4);
            p.active = true;
          } else if (p.active) {
            p.el.style.opacity = '';
            p.el.style.translate = '';
            p.el.style.scale = '';
            p.active = false;
          }
        }
        if (p.lip) {
          p.lip.style.transform = 'translate3d(0,' + (-t * 18).toFixed(2) + 'vh,0) skewY(' + (-t * 5).toFixed(3) + 'deg)';
        }
      });
    });
    queueScroll();
  }

  // --------------------------------------------
  // Stacked sticky cards (Fuel) - the card being
  // covered shrinks and dims.
  // --------------------------------------------
  function initStacks() {
    const stacks = $$('[data-stack]');
    if (!stacks.length || reduceMotion) return;
    let metrics = [];
    const measure = () => {
      metrics = stacks.map((stack) => $$('.stack-card', stack).map((card) => ({
        card,
        top: parseFloat(getComputedStyle(card).top) || 0,
        h: card.offsetHeight,
      })));
    };
    measure();
    fontsReady(3000).then(() => { measure(); queueScroll(); });
    window.addEventListener('resize', () => { measure(); queueScroll(); });

    onScroll(() => {
      const active = window.innerWidth > 860;
      metrics.forEach((cards) => {
        cards.forEach((m, i) => {
          const next = cards[i + 1];
          let p = 0;
          if (active && next) {
            const nextTop = next.card.getBoundingClientRect().top;
            const span = Math.max(1, m.top + m.h - next.top);
            p = clamp((m.top + m.h - nextTop) / span, 0, 1);
          }
          m.card.style.scale = p > 0 ? (1 - p * 0.06).toFixed(4) : '';
          m.card.style.setProperty('--dim', p.toFixed(3));
        });
      });
    });
    queueScroll();
  }

  // --------------------------------------------
  // Side section indicator (window scroll)
  // --------------------------------------------
  function initIndicator() {
    const ind = $('.section-indicator');
    if (!ind) return;
    const sections = $$('main .section');
    if (sections.length < 3) { ind.remove(); return; }

    ind.innerHTML = '';
    const dots = sections.map((s, i) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.tabIndex = -1;
      b.setAttribute('aria-label', 'Go to section ' + (i + 1));
      b.addEventListener('click', () => scrollToEl(s));
      ind.appendChild(b);
      return b;
    });

    // Active = the last section whose top has passed the middle of the screen.
    // (Pinned panels keep top <= 0, so this works with the panel stack too.)
    // Hidden over the hero (keeps the first screen clean) and over the footer.
    const footer = $('.site-footer');
    let current = -1;
    onScroll(() => {
      const vh = window.innerHeight;
      let idx = 0;
      sections.forEach((s, i) => { if (s.getBoundingClientRect().top <= vh * 0.5) idx = i; });
      const onFooter = !!footer && footer.getBoundingClientRect().top < vh * 0.65;
      const onHero = idx === 0 && sections[0].classList.contains('hero');
      ind.classList.toggle('is-hidden', onHero || onFooter);
      if (idx === current) return;
      current = idx;
      dots.forEach((d, j) => d.classList.toggle('active', j === idx));
      const ev = sections[idx].dataset.event;
      if (ev) document.dispatchEvent(new CustomEvent('section:' + ev));
    });
    queueScroll();
  }

  // --------------------------------------------
  // Footer wordmark - fit to width, rise in
  // --------------------------------------------
  function initFitText() {
    const items = $$('[data-fit]');
    if (!items.length) return;
    const fit = () => items.forEach((el) => {
      const box = el.parentElement;
      if (!box) return;
      el.style.fontSize = '100px';
      const w = el.getBoundingClientRect().width;
      const avail = box.clientWidth;
      el.style.fontSize = '';
      if (!w || !avail) return;
      box.style.setProperty('--fm-size', Math.max(40, (100 * avail) / w).toFixed(2) + 'px');
    });
    fit();
    fontsReady(4000).then(fit);
    window.addEventListener('resize', fit);

    if (reduceMotion) return;
    onScroll(() => {
      const vh = window.innerHeight;
      items.forEach((el) => {
        // 0 while the mark is still well below the fold, 1 once its bottom
        // edge reaches the bottom of the viewport (end of the page).
        const r = el.parentElement.getBoundingClientRect();
        const lead = vh * 0.3;
        const p = clamp((vh + lead - r.top) / (r.height + lead), 0, 1);
        el.style.setProperty('--fm-shift', ((1 - p) * 45).toFixed(1) + '%');
      });
    });
    queueScroll();
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

  function initNavState() {
    const nav = $('.nav');
    if (!nav) return;
    onScroll((y) => nav.classList.toggle('is-scrolled', y > 24));
    queueScroll();
  }

  function initYearStamps() {
    const year = String(new Date().getFullYear());
    $$('[data-year]').forEach((el) => { el.textContent = year; });
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
  Object.defineProperty(window.EV, 'lenis', { get: () => lenis, configurable: true });

  function boot() {
    safe('smooth-scroll', initSmoothScroll);
    safe('cursor', initCursor);
    safe('menu', initMenu);
    safe('transitions', initTransitions);
    safe('split', initSplit);
    safe('lit', initLit);
    safe('reveals', initReveals);
    safe('marquee', initMarquees);
    safe('panels', initPanels);
    safe('hero', initHeroFx);
    safe('stacks', initStacks);
    safe('indicator', initIndicator);
    safe('fit', initFitText);
    safe('magnetic', initMagnetic);
    safe('nav', initNavState);
    safe('year', initYearStamps);
    safe('loader', initLoader);   // last - it flips the page to ready
    // cat boots itself from cat.js
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
