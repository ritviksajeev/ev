// Menus and HUD are HTML in #ui, drawn over the canvas so text stays crisp at
// any screen density. A scene mounts its markup on create; it is removed when
// that scene shuts down.
const root = () => document.getElementById('ui');

export function mount(scene, html) {
  const el = root();
  const key = scene.sys.settings.key;
  el.innerHTML = html;
  el.dataset.owner = key;
  scene.events.once('shutdown', () => {
    if (el.dataset.owner === key) {
      el.innerHTML = '';
      delete el.dataset.owner;
    }
  });
  return el;
}

const ENTITIES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
export const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ENTITIES[c]);
