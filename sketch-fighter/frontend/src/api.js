// Where the Flask API lives. Empty = same origin (Flask serves the game, or the
// Vite dev proxy). "none" = static build with no server (evzero.org/sketch/).
const base = import.meta.env.VITE_API_BASE ?? '';

export const HAS_API = base !== 'none';
export const apiUrl = (path) => `${HAS_API ? base : ''}${path}`;
