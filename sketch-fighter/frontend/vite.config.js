import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

const here = (p) => fileURLToPath(new URL(p, import.meta.url));

// `vite build`            -> backend/static, served by Flask at /
// `vite build --mode web` -> /sketch at the repo root, served by GitHub Pages
//                            at evzero.org/sketch/ (no backend; see .env.web)
export default defineConfig(({ mode }) => {
  const web = mode === 'web';
  return {
    base: web ? './' : '/',
    resolve: {
      alias: { '@shared': here('../shared') },
    },
    server: {
      host: true, // reachable from a phone on the same network
      port: 5173,
      fs: { allow: [here('..')] },
      proxy: { '/api': 'http://127.0.0.1:8080' },
    },
    build: {
      outDir: web ? here('../../sketch') : here('../backend/static'),
      emptyOutDir: true,
      chunkSizeWarningLimit: 2000, // Phaser alone is ~1.2 MB minified
    },
  };
});
