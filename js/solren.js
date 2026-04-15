/* ============================================
   Solren page - game tab switching
   ============================================ */

(function () {
  'use strict';

  const tabs = document.querySelectorAll('.game-tab');
  const panels = document.querySelectorAll('.game-panel');

  tabs.forEach((tab) => {
    tab.addEventListener('click', () => {
      const target = tab.dataset.game;
      tabs.forEach((t) => t.classList.remove('active'));
      panels.forEach((p) => p.classList.remove('active'));
      tab.classList.add('active');
      const panel = document.querySelector(`.game-panel[data-game="${target}"]`);
      if (panel) panel.classList.add('active');
    });
  });
})();
