// shared/game.json, bundled at build time. The backend reads the same file;
// GAME_HASH lets Boot check that this bundle and the server agree.
import raw from '@shared/game.json?raw';

const text = raw.replace(/\r/g, '');

export const GAME = deepFreeze(JSON.parse(text));
export const GAME_HASH = fnv1a32(text);

// 32-bit FNV-1a over UTF-16 code units. backend/config.py has the same function.
export function fnv1a32(s) {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}

function deepFreeze(o) {
  Object.values(o).forEach((v) => v && typeof v === 'object' && deepFreeze(v));
  return Object.freeze(o);
}
