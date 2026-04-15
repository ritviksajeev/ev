/* ============================================
   EvZero - Common JS
   Custom cursor, starfield, section observer,
   nav hooks, page curtain, scroll indicator.
   ============================================ */

(function () {
  'use strict';

  // --------------------------------------------
  // Custom cursor
  // --------------------------------------------
  function initCursor() {
    // CSS hides the cursor visuals on mobile via @media query.
    // We always create them so they appear on actual desktop viewports
    // even if the headless preview viewport reported small initially.
    const dot = document.createElement('div');
    dot.className = 'cursor-dot';
    const ring = document.createElement('div');
    ring.className = 'cursor-ring';
    document.body.appendChild(dot);
    document.body.appendChild(ring);

    let mx = window.innerWidth / 2;
    let my = window.innerHeight / 2;
    let rx = mx, ry = my;

    window.addEventListener('mousemove', (e) => {
      mx = e.clientX;
      my = e.clientY;
      dot.style.transform = `translate(${mx}px, ${my}px) translate(-50%, -50%)`;
      window.__cursor = { x: mx, y: my };
    });

    (function tick() {
      rx += (mx - rx) * 0.18;
      ry += (my - ry) * 0.18;
      ring.style.transform = `translate(${rx}px, ${ry}px) translate(-50%, -50%)`;
      requestAnimationFrame(tick);
    })();

    const hoverables = 'a, button, [data-cursor="hover"], input, textarea';
    document.addEventListener('mouseover', (e) => {
      if (e.target.closest(hoverables)) ring.classList.add('hover');
    });
    document.addEventListener('mouseout', (e) => {
      if (e.target.closest(hoverables)) ring.classList.remove('hover');
    });
  }

  // --------------------------------------------
  // Section observer - tracks active section for
  // snap-scroll pages, drives side indicator and
  // reveal animations.
  // --------------------------------------------
  function initSectionObserver() {
    const page = document.querySelector('.page');
    if (!page) return;

    const sections = Array.from(document.querySelectorAll('.section'));
    if (!sections.length) return;

    const indicator = document.querySelector('.section-indicator');
    const dots = indicator
      ? sections.map((s, i) => {
          const b = document.createElement('button');
          b.setAttribute('aria-label', `Go to section ${i + 1}`);
          b.dataset.index = String(i);
          b.addEventListener('click', () => {
            page.scrollTo({ top: s.offsetTop, behavior: 'smooth' });
          });
          indicator.appendChild(b);
          return b;
        })
      : [];

    const io = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        const idx = sections.indexOf(entry.target);
        if (entry.isIntersecting && entry.intersectionRatio > 0.55) {
          sections.forEach((s) => s.classList.remove('is-active'));
          entry.target.classList.add('is-active');
          dots.forEach((d, i) => d.classList.toggle('active', i === idx));
          if (entry.target.dataset.event) {
            document.dispatchEvent(new CustomEvent('section:' + entry.target.dataset.event));
          }
        }
      });
    }, {
      root: page,
      threshold: [0.55, 0.75],
    });

    sections.forEach((s) => io.observe(s));
    if (sections[0]) sections[0].classList.add('is-active');
    if (dots[0]) dots[0].classList.add('active');
  }

  // --------------------------------------------
  // Page curtain transition on link navigation
  // --------------------------------------------
  function initPageCurtain() {
    const curtain = document.createElement('div');
    curtain.className = 'page-curtain';
    document.body.appendChild(curtain);

    // Animate OUT on load (reveal page)
    requestAnimationFrame(() => {
      curtain.classList.add('exit');
      setTimeout(() => curtain.classList.remove('exit'), 800);
    });

    document.addEventListener('click', (e) => {
      const a = e.target.closest('a[data-transition]');
      if (!a) return;
      const href = a.getAttribute('href');
      if (!href || href.startsWith('#') || href.startsWith('http') || href.startsWith('mailto:')) return;
      e.preventDefault();
      curtain.classList.add('enter');
      setTimeout(() => { window.location.href = href; }, 620);
    });
  }

  // --------------------------------------------
  // Year stamp helper
  // --------------------------------------------
  function initYearStamps() {
    document.querySelectorAll('[data-year]').forEach((el) => {
      el.textContent = String(new Date().getFullYear());
    });
  }

  // --------------------------------------------
  // Boot
  // --------------------------------------------
  document.addEventListener('DOMContentLoaded', () => {
    initCursor();
    initSectionObserver();
    initPageCurtain();
    initYearStamps();
    // cat boots itself from cat.js
  });
})();
