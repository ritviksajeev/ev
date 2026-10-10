// Where the Flask API lives. Empty = same origin (Flask serves the game, or the
// Vite dev proxy). "none" = static build with no server (evzero.org/sketch/).
const base = import.meta.env.VITE_API_BASE ?? '';

export const HAS_API = base !== 'none';
export const apiUrl = (path) => `${HAS_API ? base : ''}${path}`;

// POST /api/scan with upload progress (fetch has no upload progress events).
export function scanPhoto(blob, onProgress) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', apiUrl('/api/scan'));
    xhr.timeout = 30_000;
    xhr.responseType = 'json';
    xhr.upload.onprogress = (e) => e.lengthComputable && onProgress?.(e.loaded / e.total);
    xhr.upload.onload = () => onProgress?.(1);
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300 && xhr.response) resolve(xhr.response);
      else reject(new Error(xhr.response?.error || `Scan failed (${xhr.status})`));
    };
    xhr.onerror = () => reject(new Error('Could not reach the scanner'));
    xhr.ontimeout = () => reject(new Error('The scanner took too long'));
    const form = new FormData();
    form.append('image', blob, 'card.jpg');
    xhr.send(form);
  });
}

export async function enrichStage(id) {
  const res = await fetch(apiUrl(`/api/stages/${encodeURIComponent(id)}/enrich`), { method: 'POST' });
  if (!res.ok) throw new Error(`enrich ${res.status}`);
  return (await res.json()).extras;
}

export async function recentStages() {
  const res = await fetch(apiUrl('/api/stages'));
  if (!res.ok) throw new Error(`stages ${res.status}`);
  const body = await res.json();
  return Array.isArray(body) ? body : body.stages ?? [];
}
