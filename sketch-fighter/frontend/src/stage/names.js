// Local stage names for when Gemini is unavailable (no server, no key, timeout).
// All original.
const NAMES = [
  'Margin Notes', 'Graphite Gulch', 'Eraser Flats', 'Sticky Note Summit', 'Ruled Ridge', 'Doodle Docks',
  'Index Island', 'Inkwell Heights', 'Spiral Bound', 'Paper Cut Pass', 'Highlighter Hollow', 'Staple Street',
  'Crumple Canyon', 'Ballpoint Bluffs', 'Sketchbook Spire', 'Folded Corner', 'Smudge Valley', 'Blue Line Bay',
  'Scribble Station', 'Notebook Narrows', 'Red Pen Ravine', 'Tracing Terrace', 'Pencil Shavings', 'Draft Zero',
];
const LINES = [
  'Pencils down. Fists up.',
  'Fresh ink, fresh bruises.',
  'Drawn by hand, settled by hand.',
  'Mind the red lines.',
  'Every scribble counts.',
  'No erasers in this arena.',
  'Stay on the page.',
  'Somebody is getting crossed out.',
];
const COLORS = ['#a78bfa', '#6aff9a', '#ffc857', '#5b8cff', '#ff7ab6', '#7ae7ff'];

function hash(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

export function fallbackExtras(seed = '') {
  const h = hash(String(seed));
  return {
    stageName: NAMES[h % NAMES.length],
    announcerLine: LINES[(h >>> 8) % LINES.length],
    accentColor: COLORS[(h >>> 16) % COLORS.length],
    source: 'fallback',
  };
}
