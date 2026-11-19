// clipped licence server on Cloudflare Workers.
// The handlers are the same files Vercel and serve.js run (api/clipped/*.js); this only
// turns a Worker request into the small Node-style req/res they expect and back.
import activate from '../../../api/clipped/activate.js';
import checkout from '../../../api/clipped/checkout.js';
import checkoutVerify from '../../../api/clipped/checkout-verify.js';
import config from '../../../api/clipped/config.js';
import deactivate from '../../../api/clipped/deactivate.js';
import freeClaim from '../../../api/clipped/free-claim.js';
import freeStart from '../../../api/clipped/free-start.js';
import keyLookup from '../../../api/clipped/key-lookup.js';
import pickup from '../../../api/clipped/pickup.js';

const ROUTES = {
  activate, checkout, 'checkout-verify': checkoutVerify, config, deactivate,
  'free-claim': freeClaim, 'free-start': freeStart, 'key-lookup': keyLookup, pickup,
};
const MAX_BODY = 16 * 1024;

const json = (status, data) => new Response(JSON.stringify(data), {
  status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
});

export default {
  async fetch(request, env) {
    // The shared code reads its settings from process.env, as on Node.
    for (const [k, v] of Object.entries(env)) if (typeof v === 'string') process.env[k] = v;

    const url = new URL(request.url);
    if (url.pathname === '/health') return json(200, { ok: true });
    const m = url.pathname.match(/^\/(?:api\/)?clipped\/([a-z-]+)\/?$/);
    const handle = m && Object.prototype.hasOwnProperty.call(ROUTES, m[1]) ? ROUTES[m[1]] : null;
    if (!handle) return json(404, { error: 'Not found.', code: 'not_found' });

    let body = '';
    if (request.method === 'POST') {
      body = await request.text();
      if (body.length > MAX_BODY) return json(413, { error: 'That request is too big.', code: 'too_big' });
    }
    const req = {
      method: request.method,
      url: url.pathname + url.search,
      headers: Object.fromEntries(request.headers), // lower-case names, like Node
      body,
    };
    const headers = new Headers();
    let status = 200;
    let resolve;
    const done = new Promise((r) => { resolve = r; });
    const res = {
      get statusCode() { return status; },
      set statusCode(s) { status = s; },
      headersSent: false,
      setHeader(k, v) { headers.set(k, String(v)); },
      end(text) { this.headersSent = true; resolve(text); },
    };
    try {
      await handle(req, res);
    } catch (err) {
      console.error(err);
      if (!res.headersSent) return json(500, { error: 'Something went wrong on our side.', code: 'server' });
    }
    const text = await done;
    return new Response(status === 204 ? null : text ?? '', { status, headers });
  },
};
