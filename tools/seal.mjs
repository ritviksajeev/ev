#!/usr/bin/env node
/* ============================================
   seal.mjs - password-sealed pages

   A sealed page ships only a password gate plus
   one encrypted blob. Everything behind the gate
   (markup, styles, script) lives inside the blob,
   so the repo never holds it in readable form -
   and the password itself is never stored at all.

   Crypto: PBKDF2-SHA256 (1,000,000 rounds, random
   salt) -> AES-256-GCM (random IV). Same WebCrypto
   calls run in the browser to open it.

   Usage
     node tools/seal.mjs open <page.html> <dir>
         decrypt the page's blob into <dir>/page.{html,css,js}
     node tools/seal.mjs seal <dir> <page.html>
         encrypt <dir>/page.{html,css,js} into the page's blob

   The password is read from SEAL_PASSWORD, or asked
   for on the terminal. Sealing over an existing blob
   checks the password still opens it (so a typo can't
   change it); pass --new-password to change it on
   purpose. Keep <dir> out of git (.private/ is
   ignored).
   ============================================ */

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { webcrypto as crypto } from 'node:crypto';

const ITERATIONS = 1000000;
const PARTS = ['html', 'css', 'js'];
const BLOB = /(<script id="seal" type="application\/json">)([\s\S]*?)(<\/script>)/;

// Must match the gate's normalise() - spaces around it and letter case don't matter.
const normalise = (s) => s.trim().toUpperCase();

const b64 = (bytes) => Buffer.from(bytes).toString('base64');
const unb64 = (s) => new Uint8Array(Buffer.from(s, 'base64'));

async function deriveKey(password, salt, iterations) {
  const base = await crypto.subtle.importKey('raw', new TextEncoder().encode(normalise(password)), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', hash: 'SHA-256', salt, iterations },
    base,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}

async function encrypt(password, payload) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await deriveKey(password, salt, ITERATIONS);
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(JSON.stringify(payload)));
  return { v: 1, iter: ITERATIONS, salt: b64(salt), iv: b64(iv), ct: b64(new Uint8Array(ct)) };
}

async function decrypt(password, seal) {
  const key = await deriveKey(password, unb64(seal.salt), seal.iter);
  const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(seal.iv) }, key, unb64(seal.ct));
  return JSON.parse(new TextDecoder().decode(pt));
}

function readSeal(page) {
  const m = page.match(BLOB);
  if (!m) throw new Error('no <script id="seal" type="application/json"> block in the page');
  const raw = m[2].trim();
  return raw ? JSON.parse(raw) : null;
}

function askPassword(prompt) {
  if (process.env.SEAL_PASSWORD) return Promise.resolve(process.env.SEAL_PASSWORD);
  if (!process.stdin.isTTY) return Promise.reject(new Error('set SEAL_PASSWORD or run in a terminal'));
  return new Promise((resolve) => {
    process.stdout.write(prompt);
    const stdin = process.stdin;
    let value = '';
    stdin.setRawMode(true);
    stdin.resume();
    stdin.setEncoding('utf8');
    const onData = (ch) => {
      if (ch === '\r' || ch === '\n' || ch === '\u0004') {
        stdin.setRawMode(false);
        stdin.pause();
        stdin.off('data', onData);
        process.stdout.write('\n');
        resolve(value);
      } else if (ch === '\u0003') {
        process.exit(130);
      } else if (ch === '\u007f' || ch === '\b') {
        value = value.slice(0, -1);
      } else {
        value += ch;
      }
    };
    stdin.on('data', onData);
  });
}

async function open(pagePath, dir) {
  const seal = readSeal(await readFile(pagePath, 'utf8'));
  if (!seal) throw new Error('the page has no sealed content yet');
  const payload = await decrypt(await askPassword('Password: '), seal).catch(() => {
    throw new Error('wrong password');
  });
  await mkdir(dir, { recursive: true });
  for (const part of PARTS) await writeFile(join(dir, 'page.' + part), payload[part] || '');
  console.log('opened -> ' + PARTS.map((p) => join(dir, 'page.' + p)).join(', '));
}

async function seal(dir, pagePath, { newPassword }) {
  const page = await readFile(pagePath, 'utf8');
  const payload = {};
  for (const part of PARTS) payload[part] = await readFile(join(dir, 'page.' + part), 'utf8');

  const password = await askPassword('Password: ');
  if (!normalise(password)) throw new Error('empty password');
  const old = readSeal(page);
  if (old && !newPassword) {
    await decrypt(password, old).catch(() => {
      throw new Error('that password does not open the current seal (use --new-password to change it)');
    });
  }
  if (!old || newPassword) {
    if (!process.env.SEAL_PASSWORD && normalise(await askPassword('Again: ')) !== normalise(password)) {
      throw new Error('passwords do not match');
    }
  }

  const next = await encrypt(password, payload);
  await decrypt(password, next);   // round-trip check before touching the page
  await writeFile(pagePath, page.replace(BLOB, (_, a, __, c) => a + JSON.stringify(next) + c));
  console.log('sealed ' + pagePath + ' (' + next.ct.length + ' b64 chars)');
}

const [cmd, a, b] = process.argv.slice(2).filter((x) => !x.startsWith('--'));
const flags = { newPassword: process.argv.includes('--new-password') };
const run = cmd === 'open' && a && b ? open(a, b) : cmd === 'seal' && a && b ? seal(a, b, flags) : null;
if (!run) {
  console.error('usage: node tools/seal.mjs open <page.html> <dir>\n       node tools/seal.mjs seal <dir> <page.html> [--new-password]');
  process.exit(1);
}
run.catch((err) => {
  console.error('seal: ' + err.message);
  process.exit(1);
});
