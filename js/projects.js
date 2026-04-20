/* ============================================
   Projects page - modal + inline covers
   ============================================ */

(function () {
  'use strict';

  const cards = document.querySelectorAll('.project-card');

  // Modal
  const modal = document.querySelector('.project-modal');
  if (!modal) return;
  const modalTitle = modal.querySelector('.pm-title');
  const modalMeta = modal.querySelector('.pm-meta');
  const modalDesc = modal.querySelector('.pm-desc');
  const modalFiles = modal.querySelector('.pm-files');
  const modalCover = modal.querySelector('.pm-cover');
  const modalActions = modal.querySelector('.pm-actions');

  const PROJECTS = {
    'evzero-org': {
      title: 'evzero.org',
      meta: ['website', 'v1', '2026'],
      desc: [
        'The personal hub. Custom scroll-snap sections, a pixel cat that stalks your cursor, SVG logos, and fully hand-built animations.',
        'No framework. Just HTML, CSS, and JS - the way the web intended.',
      ],
      files: ['index.html', 'css/common.css', 'js/cat.js', 'assets/logo.svg'],
      cover: coverWave('#8b5cf6'),
    },
    'pixel-cat': {
      title: 'pixel-cat',
      meta: ['widget', 'open source', '2026'],
      desc: [
        'The cat running around this site, extracted into a standalone drop-in web component. State machine for idle / walk / sleep / play, cursor tracking, and a pluggable sprite system.',
      ],
      files: ['src/cat.ts', 'sprites/', 'README.md'],
      cover: coverCat(),
    },
    'watchparty': {
      title: 'watchparty',
      meta: ['extension', 'ws relay', '2026'],
      desc: [
        'Two browsers, one video, same frame. Chrome/Firefox extension hooks the HTML5 video element on Netflix / YouTube / Disney+ and pipes play/pause/seek events through a tiny Node WebSocket relay.',
        'Rooms are created from the site — share a link, join, press play. No screenshare, no quality loss.',
      ],
      files: ['server/server.js', 'watch/index.html', 'extension/content.js (wip)'],
      cover: coverWatch(),
      actions: [{ label: 'Open watchparty →', href: '../watch/' }],
    },
    'mystery': {
      title: '???',
      meta: ['classified', 'wip', 'soon'],
      desc: [
        'Still under the tarp. Check back later.',
        'If you really want a hint: it probably involves purple.',
      ],
      files: ['[redacted]'],
      cover: coverMystery(),
    },
  };

  function openModal(id) {
    const data = PROJECTS[id];
    if (!data) return;
    modalTitle.textContent = data.title;
    modalMeta.innerHTML = data.meta.map((m) => `<span>${m}</span>`).join('');
    modalDesc.innerHTML = data.desc.map((p) => `<p>${p}</p>`).join('');
    modalFiles.innerHTML = data.files.map((f) => `<div class="file-line">${f}</div>`).join('');
    modalCover.innerHTML = data.cover;
    modalActions.innerHTML = (data.actions || [])
      .map((a) => `<a class="pm-btn" href="${a.href}" data-transition>${a.label}</a>`)
      .join('');
    modal.classList.add('open');
    document.body.style.overflow = 'hidden';
  }
  function closeModal() {
    modal.classList.remove('open');
    document.body.style.overflow = '';
  }

  cards.forEach((card) => {
    card.addEventListener('click', (e) => {
      e.preventDefault();
      openModal(card.dataset.project);
    });
  });
  modal.querySelector('.project-modal-close').addEventListener('click', closeModal);
  modal.querySelector('.project-modal-backdrop').addEventListener('click', closeModal);
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && modal.classList.contains('open')) closeModal();
  });

  // -------- cover generators (inline SVGs) --------
  function coverWave(c) {
    return `
      <svg viewBox="0 0 400 250" xmlns="http://www.w3.org/2000/svg">
        <defs>
          <linearGradient id="wg" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stop-color="${c}"/>
            <stop offset="100%" stop-color="#5b21b6"/>
          </linearGradient>
        </defs>
        <rect width="400" height="250" fill="#050507"/>
        <g stroke="url(#wg)" stroke-width="6" fill="none" stroke-linecap="round">
          <path d="M 0 50 Q 100 10 200 50 T 400 50"/>
          <path d="M 0 90 Q 100 50 200 90 T 400 90"/>
          <path d="M 0 130 Q 100 90 200 130 T 400 130"/>
          <path d="M 0 170 Q 100 130 200 170 T 400 170"/>
          <path d="M 0 210 Q 100 170 200 210 T 400 210"/>
        </g>
      </svg>
    `;
  }
  function coverCat() {
    return `
      <svg viewBox="0 0 400 250" xmlns="http://www.w3.org/2000/svg">
        <rect width="400" height="250" fill="#050507"/>
        <g transform="translate(130 60) scale(9)" shape-rendering="crispEdges">
          <rect x="2" y="2" width="2" height="2" fill="#050507"/>
          <rect x="12" y="2" width="2" height="2" fill="#050507"/>
          <rect x="2" y="4" width="12" height="5" fill="#050507"/>
          <rect x="3" y="5" width="10" height="3" fill="#131319"/>
          <rect x="5" y="6" width="1" height="1" fill="#a78bfa"/>
          <rect x="10" y="6" width="1" height="1" fill="#a78bfa"/>
          <rect x="7" y="7" width="2" height="1" fill="#fff"/>
          <rect x="3" y="9" width="10" height="4" fill="#050507"/>
          <rect x="4" y="10" width="8" height="2" fill="#131319"/>
          <rect x="3" y="13" width="2" height="2" fill="#050507"/>
          <rect x="6" y="13" width="2" height="2" fill="#050507"/>
          <rect x="8" y="13" width="2" height="2" fill="#050507"/>
          <rect x="11" y="13" width="2" height="2" fill="#050507"/>
          <rect x="14" y="9" width="2" height="1" fill="#050507"/>
          <rect x="15" y="8" width="1" height="2" fill="#8b5cf6"/>
        </g>
      </svg>
    `;
  }
  function coverWatch() {
    return `
      <svg viewBox="0 0 400 250" xmlns="http://www.w3.org/2000/svg">
        <defs>
          <linearGradient id="wpg" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stop-color="#8b5cf6"/>
            <stop offset="100%" stop-color="#5b21b6"/>
          </linearGradient>
        </defs>
        <rect width="400" height="250" fill="#050507"/>
        <rect x="60" y="55" width="130" height="80" rx="4" fill="none" stroke="url(#wpg)" stroke-width="2"/>
        <polygon points="115,80 115,110 140,95" fill="#a78bfa"/>
        <rect x="210" y="115" width="130" height="80" rx="4" fill="none" stroke="url(#wpg)" stroke-width="2"/>
        <polygon points="265,140 265,170 290,155" fill="#a78bfa"/>
        <path d="M 190 95 Q 200 125 210 155" stroke="#a78bfa" stroke-width="1.5" stroke-dasharray="3 4" fill="none"/>
        <circle cx="190" cy="95" r="3" fill="#a78bfa"/>
        <circle cx="210" cy="155" r="3" fill="#a78bfa"/>
      </svg>
    `;
  }
  function coverMystery() {
    return `
      <svg viewBox="0 0 400 250" xmlns="http://www.w3.org/2000/svg">
        <rect width="400" height="250" fill="#050507"/>
        <g stroke="rgba(167,139,250,0.18)" stroke-width="1">
          ${Array.from({length: 10}, (_, i) => `<line x1="${i * 40}" y1="0" x2="${i * 40}" y2="250"/>`).join('')}
          ${Array.from({length: 7}, (_, i) => `<line x1="0" y1="${i * 40}" x2="400" y2="${i * 40}"/>`).join('')}
        </g>
        <text x="200" y="168" font-family="Unbounded, sans-serif" font-size="160" font-weight="900"
              fill="none" stroke="rgba(167,139,250,0.55)" stroke-width="1.5"
              text-anchor="middle" letter-spacing="-6">?</text>
      </svg>
    `;
  }

  // render covers into the cards on load (via data-cover attr)
  cards.forEach((card) => {
    const coverEl = card.querySelector('.project-cover');
    if (!coverEl) return;
    const type = card.dataset.coverType;
    const color = card.dataset.coverColor || '#a78bfa';
    let svg = '';
    switch (type) {
      case 'wave':    svg = coverWave(color); break;
      case 'cat':     svg = coverCat(); break;
      case 'watch':   svg = coverWatch(); break;
      case 'mystery': svg = coverMystery(); break;
      default:        svg = coverWave(color);
    }
    coverEl.insertAdjacentHTML('afterbegin', svg);
  });
})();
