#!/usr/bin/env node
/* ============================================
   clipped licence server as one plain Node process, for hosts that run a
   server rather than functions (Railway, Render, Fly, a VPS):

       node api/_lib/serve.js            # listens on $PORT (default 8787)

   It serves exactly the same handlers as the Vercel functions in
   api/clipped/, at /clipped/<name>/ and /api/clipped/<name>/ (with or
   without the trailing slash), plus GET /health. Set the same environment
   variables (see clipped.js). Lives under _lib so Vercel never turns it
   into a function.
   ============================================ */
'use strict';
const http = require('http');
const path = require('path');
const fs = require('fs');

const DIR = path.join(__dirname, '..', 'clipped');
const routes = new Map(
  fs.readdirSync(DIR).filter((f) => f.endsWith('.js')).map((f) => [f.slice(0, -3), require(path.join(DIR, f))]),
);

function json(res, status, data) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(data));
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  if (url.pathname === '/health') return json(res, 200, { ok: true });
  const m = url.pathname.match(/^\/(?:api\/)?clipped\/([a-z-]+)\/?$/);
  const fn = m && routes.get(m[1]);
  if (!fn) return json(res, 404, { error: 'Not found.', code: 'not_found' });
  try {
    await fn(req, res);
  } catch (err) {
    console.error(err);
    if (!res.headersSent) json(res, 500, { error: 'Something went wrong on our side.', code: 'server' });
  }
});

server.headersTimeout = 15000;
server.requestTimeout = 20000;

if (require.main === module) {
  const port = Number(process.env.PORT) || 8787;
  server.listen(port, () => console.log(`clipped licence server on :${port} (${routes.size} routes)`));
}

module.exports = { server, routes };
