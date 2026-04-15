/* ============================================
   EvZero - Pixel cat
   Roams around every page, reacts to cursor.
   States: idle, walking, watching, playing,
   sleeping, meowing, snuggling.
   ============================================ */

function bootCat() {
  'use strict';

  if (document.querySelector('.pixel-cat')) return;

  // SVG pixel-art cat, 16x16 style, scaled up.
  // Uses <rect>s for the pixel look. Body is purple/black/white.
  const CAT_SVG = `
    <svg class="cat-sprite" viewBox="0 0 16 16" xmlns="http://www.w3.org/2000/svg" shape-rendering="crispEdges">
      <!-- ears -->
      <rect x="2" y="2" width="2" height="2" fill="#0a0712"/>
      <rect x="12" y="2" width="2" height="2" fill="#0a0712"/>
      <rect x="3" y="3" width="1" height="1" fill="#8a2be2"/>
      <rect x="12" y="3" width="1" height="1" fill="#8a2be2"/>
      <!-- head -->
      <rect x="2" y="4" width="12" height="5" fill="#0a0712"/>
      <rect x="3" y="5" width="10" height="3" fill="#1a0f30"/>
      <!-- eyes -->
      <rect x="5" y="6" width="1" height="1" fill="#a855f7"/>
      <rect x="10" y="6" width="1" height="1" fill="#a855f7"/>
      <!-- nose -->
      <rect x="7" y="7" width="2" height="1" fill="#ffffff"/>
      <!-- body -->
      <rect x="3" y="9" width="10" height="4" fill="#0a0712"/>
      <rect x="4" y="10" width="8" height="2" fill="#1a0f30"/>
      <!-- legs -->
      <rect x="3" y="13" width="2" height="2" fill="#0a0712"/>
      <rect x="6" y="13" width="2" height="2" fill="#0a0712"/>
      <rect x="8" y="13" width="2" height="2" fill="#0a0712"/>
      <rect x="11" y="13" width="2" height="2" fill="#0a0712"/>
      <!-- tail -->
      <rect x="14" y="9" width="2" height="1" fill="#0a0712"/>
      <rect x="15" y="8" width="1" height="2" fill="#8a2be2"/>
    </svg>
  `;

  const CAT_SLEEP_SVG = `
    <svg class="cat-sprite" viewBox="0 0 16 16" xmlns="http://www.w3.org/2000/svg" shape-rendering="crispEdges">
      <!-- curled up body -->
      <rect x="2" y="8" width="12" height="5" fill="#0a0712"/>
      <rect x="3" y="9" width="10" height="3" fill="#1a0f30"/>
      <!-- ear -->
      <rect x="3" y="7" width="2" height="1" fill="#0a0712"/>
      <rect x="4" y="6" width="1" height="1" fill="#0a0712"/>
      <!-- closed eye -->
      <rect x="5" y="9" width="2" height="1" fill="#8a2be2"/>
      <rect x="9" y="9" width="2" height="1" fill="#8a2be2"/>
      <!-- tail curled -->
      <rect x="12" y="7" width="1" height="1" fill="#0a0712"/>
      <rect x="13" y="7" width="1" height="1" fill="#8a2be2"/>
    </svg>
  `;

  const CAT_PLAY_SVG = `
    <svg class="cat-sprite" viewBox="0 0 16 16" xmlns="http://www.w3.org/2000/svg" shape-rendering="crispEdges">
      <!-- leaping pose -->
      <rect x="2" y="1" width="2" height="2" fill="#0a0712"/>
      <rect x="12" y="1" width="2" height="2" fill="#0a0712"/>
      <rect x="3" y="2" width="1" height="1" fill="#8a2be2"/>
      <rect x="12" y="2" width="1" height="1" fill="#8a2be2"/>
      <rect x="2" y="3" width="12" height="5" fill="#0a0712"/>
      <rect x="3" y="4" width="10" height="3" fill="#1a0f30"/>
      <!-- big alert eyes -->
      <rect x="5" y="5" width="1" height="2" fill="#a855f7"/>
      <rect x="10" y="5" width="1" height="2" fill="#a855f7"/>
      <rect x="7" y="6" width="2" height="1" fill="#ffffff"/>
      <!-- stretched body -->
      <rect x="3" y="8" width="10" height="3" fill="#0a0712"/>
      <rect x="4" y="9" width="8" height="1" fill="#1a0f30"/>
      <!-- outstretched legs -->
      <rect x="2" y="11" width="3" height="2" fill="#0a0712"/>
      <rect x="11" y="11" width="3" height="2" fill="#0a0712"/>
      <!-- tail up -->
      <rect x="14" y="5" width="2" height="1" fill="#0a0712"/>
      <rect x="15" y="3" width="1" height="2" fill="#8a2be2"/>
    </svg>
  `;

  // ----- State -----
  const cat = document.createElement('div');
  cat.className = 'pixel-cat';
  cat.dataset.state = 'idle';
  cat.innerHTML =
    '<div class="cat-flipper">' + CAT_SVG + '</div>' +
    '<span class="cat-z">z</span>' +
    '<span class="cat-meow">meow!</span>';
  document.body.appendChild(cat);
  const flipper = cat.querySelector('.cat-flipper');

  const bubbles = [
    'meow!', 'prr...', 'nya~', '...', 'mrrp', 'pspsps?', 'meow?', '*yawn*'
  ];

  let x = window.innerWidth * 0.8;
  let y = window.innerHeight * 0.85;
  let targetX = x;
  let targetY = y;
  let state = 'idle';
  let stateTimer = 0;
  let facingLeft = false;

  function setSprite(variant) {
    let svg = CAT_SVG;
    if (variant === 'sleep') svg = CAT_SLEEP_SVG;
    else if (variant === 'play') svg = CAT_PLAY_SVG;
    flipper.innerHTML = svg;
  }

  function setState(next) {
    state = next;
    cat.dataset.state = next;
    if (next === 'sleeping') setSprite('sleep');
    else if (next === 'playing') setSprite('play');
    else setSprite('normal');
  }

  function pickNewTarget() {
    const margin = 80;
    targetX = margin + Math.random() * (window.innerWidth - margin * 2);
    targetY = 140 + Math.random() * (window.innerHeight - 240);
  }

  function meow() {
    const bubble = cat.querySelector('.cat-meow');
    if (!bubble) return;
    bubble.textContent = bubbles[Math.floor(Math.random() * bubbles.length)];
    cat.dataset.meowing = 'true';
    clearTimeout(meow._t);
    meow._t = setTimeout(() => { cat.dataset.meowing = 'false'; }, 1600);
  }

  function dist(ax, ay, bx, by) {
    const dx = ax - bx, dy = ay - by;
    return Math.sqrt(dx * dx + dy * dy);
  }

  // ----- Main loop -----
  function tick() {
    const cursor = window.__cursor;
    stateTimer--;

    if (cursor) {
      const d = dist(x + 16, y + 16, cursor.x, cursor.y);

      // Snuggle / play if very close
      if (d < 90 && state !== 'playing') {
        setState('playing');
        targetX = cursor.x - 16 + (Math.random() - 0.5) * 40;
        targetY = cursor.y - 16 + (Math.random() - 0.5) * 40;
        stateTimer = 30;
        if (Math.random() < 0.3) meow();
      }
      // Watch cursor if medium distance
      else if (d < 260 && state === 'idle') {
        // pivot head / face cursor
        facingLeft = cursor.x < x;
      }
      // Chase cursor occasionally
      else if (d < 400 && state !== 'playing' && state !== 'walking' && Math.random() < 0.01) {
        setState('walking');
        targetX = cursor.x - 16;
        targetY = cursor.y - 16;
        stateTimer = 90;
      }
    }

    // State transitions
    if (stateTimer <= 0) {
      if (state === 'sleeping') {
        // wake up eventually
        if (Math.random() < 0.015) {
          setState('idle');
          stateTimer = 60;
          meow();
        }
      } else if (state === 'idle') {
        const r = Math.random();
        if (r < 0.35) {
          setState('walking');
          pickNewTarget();
          stateTimer = 140;
        } else if (r < 0.45) {
          setState('sleeping');
          stateTimer = 300;
        } else if (r < 0.55) {
          meow();
          stateTimer = 80;
        } else {
          stateTimer = 80;
        }
      } else if (state === 'walking') {
        // arrived?
        if (dist(x, y, targetX, targetY) < 10) {
          setState('idle');
          stateTimer = 100;
        } else {
          // still moving, extend
          stateTimer = 80;
        }
      } else if (state === 'playing') {
        setState('idle');
        stateTimer = 70;
      }
    }

    // Movement
    if (state === 'walking' || state === 'playing') {
      const dx = targetX - x;
      const dy = targetY - y;
      const d = Math.sqrt(dx * dx + dy * dy);
      const speed = state === 'playing' ? 4 : 1.6;
      if (d > 2) {
        x += (dx / d) * speed;
        y += (dy / d) * speed;
        facingLeft = dx < 0;
      }
    }

    // Position
    cat.style.transform = `translate(${x}px, ${y}px)`;
    flipper.classList.toggle('flip', facingLeft);

    requestAnimationFrame(tick);
  }

  // initial state
  pickNewTarget();
  setState('idle');
  requestAnimationFrame(tick);

  // Hide cat when user explicitly clicks it (easter egg: teleport + meow)
  document.addEventListener('click', (e) => {
    const r = cat.getBoundingClientRect();
    if (e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom) {
      meow();
      setState('playing');
      stateTimer = 60;
    }
  });

  // Keep cat inside viewport on resize
  window.addEventListener('resize', () => {
    x = Math.min(x, window.innerWidth - 40);
    y = Math.min(y, window.innerHeight - 40);
    pickNewTarget();
  });
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', bootCat);
} else {
  bootCat();
}
