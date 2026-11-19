# clipped licence server on Cloudflare Workers

The same handlers as `api/clipped/` (shared code in `api/_lib/clipped.js`), run by
`src/index.js` on Cloudflare Workers. It issues free day keys after the ads, sells
Pro through Razorpay, and keeps each Pro key on one computer. The clipped app and
the pages on evzero.org find it through `clipped/api.json` in this repo.

Free plan limits (100,000 requests a day) are far more than clipped needs, and the
free plan allows commercial use.

## One-time setup

1. **Storage.** Make a free Redis database at [upstash.com](https://upstash.com)
   (Redis → Create database, any region; Mumbai is closest to India). On its page,
   under **REST API**, copy `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN`.
2. **Cloudflare.** Sign up at [dash.cloudflare.com](https://dash.cloudflare.com) (free).
   Open **Workers & Pages** once so it gives you a `*.workers.dev` subdomain.
3. **Deploy.** Either:
   - **From GitHub (recommended):** My Profile → API Tokens → Create Token → template
     **Edit Cloudflare Workers** → create, and copy it. In GitHub, `ev` → Settings →
     Secrets and variables → Actions, add secrets `CLOUDFLARE_API_TOKEN` (the token)
     and `CLOUDFLARE_ACCOUNT_ID` (Workers & Pages → Account details). Then Actions →
     **clipped-api** → Run workflow. Every later push to `main` that touches the server
     redeploys it.
   - **From your computer:** `cd workers/clipped-api && npm ci && npx wrangler login && npx wrangler deploy`.

   The Worker is then at `https://clipped-api.<your-subdomain>.workers.dev`.
4. **Secrets.** Cloudflare → Workers & Pages → **clipped-api** → Settings →
   Variables and Secrets → Add, type **Secret**:
   - `CLIPPED_SIGNING_KEY`: the whole `clipped-signing-key.pem` (open it in Notepad,
     copy everything, paste; line breaks don't matter).
   - `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN` from step 1.

   Check `https://clipped-api.<your-subdomain>.workers.dev/clipped/config/`: it should
   say `"free":{"ready":true,…}`.
5. **Switch it on.** Put the address in `clipped/api.json` and push it to `main`:
   ```json
   { "api": "https://clipped-api.<your-subdomain>.workers.dev/clipped" }
   ```
   From then on the app's **Get a free day** and the evzero.org pages use it. Also add
   the repository variable `CLIPPED_API_URL` = `https://clipped-api.<your-subdomain>.workers.dev`
   so each deploy checks the live server.

## Payments (Pro)

Add these as secrets too, once your Razorpay account is approved and the two plans exist:
`RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`, `RAZORPAY_PLAN_USD`, `RAZORPAY_PLAN_INR`.
`config/` then says `"pro":{"ready":true,…}` and the buy page opens Razorpay Checkout.

## Ads (free days)

Until ads are on, the free page shows a 5-second countdown instead. When the Google
Ad Manager rewarded ad unit is ready, add plain-text variables
`CLIPPED_ADS_ENABLED` = `1` and `CLIPPED_ADS_UNIT` = the unit path
(e.g. `/1234567/clipped_rewarded`). `CLIPPED_ADS_REQUIRED` (default 3) sets how many.

## Developing

- `npm ci && npx wrangler dev` runs it locally in workerd. Put local secrets in
  `.dev.vars` (git-ignored), e.g. `CLIPPED_SIGNING_KEY="-----BEGIN PRIVATE KEY-----\n…"`.
- `node --test ../../api/_lib/__tests__/*.test.js` runs the tests;
  `CLIPPED_API_URL=http://127.0.0.1:8787 node --test ../../api/_lib/__tests__/serve.test.js`
  runs the HTTP checks against the local Worker.
