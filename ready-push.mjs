#!/usr/bin/env node
// Saves the SKUs shown in Seller Hub > Listings > Inactive > Ready for Activation (read in Chrome on the
// Mac) to listings/ready.json and pushes it. GitHub then activates exactly those SKUs, nothing else.
//
//   node ready-push.mjs '{"ok":1,"skus":["SKU1","SKU2"]}'     the full list in the tab (all pages)
//   node ready-push.mjs '{"ok":1,"skus":[]}'                  the tab is empty
//   node ready-push.mjs '{"ok":0,"e":"signed_out"}'           couldn't read it (signed_out | page_not_loaded)
//
// A changed, non-empty list starts the Autopilot run straight away; otherwise the commit carries
// [skip ci] and the next 30-minute run uses it.

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const ROOT = dirname(fileURLToPath(import.meta.url));
const FILE = join(ROOT, 'listings', 'ready.json');
const cfg = existsSync(join(ROOT, 'config.json')) ? JSON.parse(readFileSync(join(ROOT, 'config.json'), 'utf8')) : {};

{ // Paused overnight like the rest of Autopilot.
  const q = cfg.pausedHours, tz = cfg.timezone || 'Asia/Kolkata';
  if (q && q.from && q.to) {
    const p = Object.fromEntries(new Intl.DateTimeFormat('en-GB', { timeZone: tz, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(new Date()).map(x => [x.type, x.value]));
    const t = Number(p.hour) * 60 + Number(p.minute), m = s => { const [h, mm] = s.split(':').map(Number); return h * 60 + (mm || 0); };
    const a = m(q.from), b = m(q.to);
    if (a <= b ? t >= a && t < b : t >= a || t < b) { console.log(`Paused ${q.from}–${q.to} (${tz}); not pushed.`); process.exit(0); }
  }
}

const ERRORS = { signed_out: 'Chrome is signed out of Flipkart Seller Hub.', page_not_loaded: "The Ready for Activation tab didn't load." };
let raw;
try { raw = JSON.parse(process.argv[2] || ''); } catch { console.error('Pass the JSON described at the top of this file.'); process.exit(2); }
if (Array.isArray(raw)) raw = { ok: 1, skus: raw };
const ok = raw.ok === 1 || raw.ok === true;
const doc = {
  checkedAt: new Date().toISOString(),
  ok,
  error: ok ? null : ERRORS[raw.e] || `Couldn't read the tab (${raw.e || 'unknown'}).`,
  skus: ok ? [...new Set((raw.skus || []).map(s => String(s).trim()).filter(Boolean))].sort() : [],
};

const prev = existsSync(FILE) ? JSON.parse(readFileSync(FILE, 'utf8')) : null;
const key = d => (d ? `${d.ok}|${d.skus.join(',')}` : '');
const changed = key(prev) !== key(doc) && (doc.skus.length > 0 || !doc.ok);
const summary = doc.ok ? `${doc.skus.length} in Ready for Activation` : doc.error;

const git = (...args) => execFileSync('git', ['-C', ROOT, ...args], { stdio: ['ignore', 'pipe', 'pipe'] }).toString().trim();
try {
  git('pull', '--rebase', '--autostash', '-q');
  mkdirSync(dirname(FILE), { recursive: true });
  writeFileSync(FILE, JSON.stringify(doc, null, 2) + '\n');
  git('add', 'listings/ready.json');
  git('commit', '-q', '-m', changed ? `Ready for Activation: ${summary}` : `Ready for Activation check: ${summary} [skip ci]`, '--', 'listings/ready.json');
  git('push', '-q');
  console.log(`${changed ? 'Changed, pushed (activation run starts now)' : 'Pushed'}: ${summary}`);
} catch (e) {
  console.error(`Push failed: ${(e.stderr && e.stderr.toString().trim()) || e.message}`);
  process.exit(1);
}
