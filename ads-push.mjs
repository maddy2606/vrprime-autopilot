#!/usr/bin/env node
// Saves one Flipkart Ads reading (taken in Chrome on the Mac by ads/read-ads.js) to ads/latest.json
// and pushes it to GitHub.
//
//   node ads-push.mjs '<the JSON line read-ads.js returned>'
//
// Every reading is pushed so the budget page stays fresh. When the set of problems changed (a
// campaign went out of budget, came back, the wallet got low, Chrome got signed out) the push starts
// the Autopilot workflow straight away, so the Gmail alert goes out within a minute or two. Otherwise
// the commit carries [skip ci] and the next 30-minute run picks it up (no Actions minutes used).

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const ROOT = dirname(fileURLToPath(import.meta.url));
const FILE = join(ROOT, 'ads', 'latest.json');
const cfg = existsSync(join(ROOT, 'config.json')) ? JSON.parse(readFileSync(join(ROOT, 'config.json'), 'utf8')) : {};
const WALLET_MIN_DAYS = Number(cfg.ads?.walletMinDays) || 3;

const ERRORS = {
  signed_out: 'Chrome is signed out of Flipkart Seller Hub. Sign in again so ads can be checked.',
  page_not_loaded: "The Seller Hub ads page didn't load in Chrome.",
  no_data: "The Budget Exhausting list didn't load in Seller Hub.",
};

// Paused overnight like the rest of Autopilot: nothing is pushed, so no GitHub run starts.
{
  const q = cfg.pausedHours, tz = cfg.timezone || 'Asia/Kolkata';
  if (q && q.from && q.to) {
    const p = Object.fromEntries(new Intl.DateTimeFormat('en-GB', { timeZone: tz, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(new Date()).map(x => [x.type, x.value]));
    const t = Number(p.hour) * 60 + Number(p.minute), m = s => { const [h, mm] = s.split(':').map(Number); return h * 60 + (mm || 0); };
    const a = m(q.from), b = m(q.to);
    if (a <= b ? t >= a && t < b : t >= a || t < b) { console.log(`Paused ${q.from}–${q.to} (${tz}); not pushed.`); process.exit(0); }
  }
}

let raw;
try { raw = JSON.parse(process.argv[2] || ''); } catch { console.error('Pass the JSON line from ads/read-ads.js as the only argument.'); process.exit(2); }

const now = new Date();
const doc = { checkedAt: now.toISOString(), ok: raw.ok === 1, error: raw.ok === 1 ? null : ERRORS[raw.e] || `Ads check failed (${raw.e || 'unknown'}).` };
if (doc.ok) {
  const dailySpend = raw.s && raw.d ? raw.s / raw.d : null;
  doc.wallet = { balance: raw.w, spend7d: raw.s, days: raw.d, dailySpend: dailySpend && Math.round(dailySpend), daysLeft: dailySpend ? Math.round((raw.w / dailySpend) * 10) / 10 : null, minDays: WALLET_MIN_DAYS };
  doc.campaigns = (raw.c || []).map(([name, remaining, budget, t, live]) => ({
    name, remaining, budget, budgetType: t === 'D' ? 'daily' : 'total', live: !!live,
    problem: remaining !== null && remaining <= 0 ? 'out_of_budget' : 'near_budget',
  }));
  doc.total = raw.n ?? doc.campaigns.length;
}

const keys = d => {
  if (!d) return '';
  if (!d.ok) return `error:${d.error}`;
  const k = (d.campaigns || []).filter(c => c.problem === 'out_of_budget').map(c => `oob:${c.name}`);
  if (d.wallet && d.wallet.daysLeft !== null && d.wallet.daysLeft < WALLET_MIN_DAYS) k.push('wallet_low');
  return k.sort().join('|');
};

const prev = existsSync(FILE) ? JSON.parse(readFileSync(FILE, 'utf8')) : null;
const changed = keys(prev) !== keys(doc);
const summary = doc.ok ? `${doc.campaigns.filter(c => c.problem === 'out_of_budget').length} out of budget, ${doc.campaigns.filter(c => c.problem === 'near_budget').length} near, wallet ${doc.wallet.daysLeft ?? '?'} days` : doc.error;

const git = (...args) => execFileSync('git', ['-C', ROOT, ...args], { stdio: ['ignore', 'pipe', 'pipe'] }).toString().trim();
try {
  git('pull', '--rebase', '--autostash', '-q');
  writeFileSync(FILE, JSON.stringify(doc, null, 2) + '\n');
  git('add', 'ads/latest.json');
  git('commit', '-q', '-m', changed ? `Ads: ${summary}` : `Ads check: ${summary} [skip ci]`, '--', 'ads/latest.json');
  git('push', '-q');
  console.log(`${changed ? 'Changed, pushed (alert run starts now)' : 'Pushed'}: ${summary}`);
} catch (e) {
  console.error(`Push failed: ${(e.stderr && e.stderr.toString().trim()) || e.message}`);
  process.exit(1);
}
