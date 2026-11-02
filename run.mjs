#!/usr/bin/env node
// VRPRIME Autopilot. One run (GitHub Actions runs it every 30 minutes):
//   1. Activates every Flipkart listing in Seller Hub's "Ready for Activation" tab (inactive, not archived).
//   2. Reads the latest Flipkart Ads reading (ads/latest.json) and rebuilds the budget page.
//   3. Emails you on Gmail when a campaign goes out of budget (and when listings were activated).
//
//   node run.mjs            the real thing
//   node run.mjs --preview  no listing changes, no email; writes the page to preview/
//
// Paused every night from 11:00 PM to 8:00 AM India time (config.json "pausedHours").

import { join } from 'node:path';
import { ROOT, loadEnv, readJson, writeFile, inQuietHours, lastPauseEnd } from './lib/util.mjs';
import { createClient } from './lib/flipkart.mjs';
import { runActivation } from './lib/activate.mjs';
import { evaluateAds } from './lib/ads.mjs';
import { renderMarkdown, renderHtml, alertEmail } from './lib/page.mjs';
import { sendMail } from './lib/mail.mjs';

const PREVIEW = process.argv.includes('--preview');
const env = loadEnv();
const cfg = readJson(join(ROOT, 'config.json'), {});
const TZ = cfg.timezone || 'Asia/Kolkata';
const STATE_FILE = join(ROOT, 'state', 'state.json');
const state = readJson(STATE_FILE, {});
const now = Date.now();
const log = (...a) => console.log(...a);

// Paused overnight (config.json "pausedHours", India time): no activation, no page update, no email.
// Pressing "Run workflow" by hand still runs (FORCE_RUN=1).
if (inQuietHours(now, TZ, cfg.pausedHours) && env.FORCE_RUN !== '1' && !PREVIEW) {
  log(`Paused ${cfg.pausedHours.from}–${cfg.pausedHours.to} (${TZ}). Nothing done.`);
  process.exit(0);
}

/* 1. Listings */
const actCfg = { enabled: true, emailWhenActivated: true, ...(cfg.activation || {}) };
let act = null;
const READY_FILE = join(ROOT, 'listings', 'ready.json');
const ready = readJson(READY_FILE, null);
const readyAgeMin = ready?.checkedAt ? (now - Date.parse(ready.checkedAt)) / 6e4 : null;
const readyFresh = !!(ready && ready.ok !== false && Array.isArray(ready.skus) && readyAgeMin !== null && readyAgeMin <= (Number(actCfg.readyMaxAgeMinutes) || 90));
if (!actCfg.enabled) act = { disabled: true };
else if (!readyFresh) {
  act = { noList: true, readyCheckedAt: ready?.checkedAt || null, readyError: ready && ready.ok === false ? ready.error : null };
  log(`Listings: no fresh Ready for Activation list from the Mac (${ready?.checkedAt ? `last read ${ready.checkedAt}` : 'never read'}); nothing activated.`);
} else {
  try {
    const client = createClient({ base: env.FLIPKART_API_BASE || undefined, appId: env.FLIPKART_APP_ID, appSecret: env.FLIPKART_APP_SECRET });
    act = await runActivation({ client, state, cfg: { ...actCfg, onlySkus: ready.skus, dryRun: actCfg.dryRun || PREVIEW }, now, log });
    state.activationFails = 0;
    log(`Listings: Ready for Activation tab had ${act.listed} SKU(s) (read ${ready.checkedAt}); ${act.alreadyActive} already active, ${act.notFound} not found; ${act.inactive} inactive, ${act.archived} archived, ${act.ignored} ignored, ${act.waiting.length} waiting to retry; tried ${act.tried}, activated ${act.activated.length}${act.dryRun ? ' (dry run)' : ''}, failed ${act.failed.length}.`);
    for (const a of act.activated) log(`  ✓ ${a.sku}  ${a.title}`);
    for (const a of act.failed) log(`  ✗ ${a.sku}  ${a.error}`);
  } catch (e) {
    state.activationFails = (state.activationFails || 0) + 1;
    act = { error: e.message };
    log(`Listings: check failed (${state.activationFails} in a row): ${e.message}`);
  }
}

/* 2. Ads */
const adsDoc = readJson(join(ROOT, 'ads', 'latest.json'), null);
const { view: ads, alerts } = evaluateAds({ doc: adsDoc, state, cfg: { ...(cfg.ads || {}), pauseEndedAt: lastPauseEnd(now, TZ, cfg.pausedHours) }, now });
log(`Ads: read ${ads.checkedAt || 'never'}${ads.stale ? ' (stale)' : ''}; ${ads.outCount} out of budget, ${ads.nearCount} running out; ${alerts.length} new alert(s).`);

// Three failed listing checks in a row (bad keys, Flipkart down) is worth an email, once.
if (state.activationFails === 3) alerts.push({ key: 'act_error', kind: 'act_error', text: `Listing auto-activation has failed 3 runs in a row: ${act.error}` });

/* 3. Email */
const pageUrl = env.PAGE_URL || (env.GITHUB_REPOSITORY ? `https://github.com/${env.GITHUB_REPOSITORY}/blob/main/BUDGET.md` : '');
const mail = alertEmail({
  alerts,
  ads,
  activation: act?.activated && !act.dryRun && actCfg.emailWhenActivated ? act.activated : [],
  failures: act?.newlyFailed || [],
  tz: TZ,
  pageUrl,
});
let mailFailed = false;
if (mail && PREVIEW) {
  writeFile(join(ROOT, 'preview', 'email.html'), mail.html);
  log(`Email (preview only, not sent): ${mail.subject}`);
} else if (mail) {
  try {
    const to = await sendMail({ user: env.GMAIL_USER, pass: env.GMAIL_APP_PASSWORD, to: env.ALERT_EMAIL_TO || env.GMAIL_USER, subject: mail.subject, html: mail.html });
    log(`Email sent to ${to.length} address(es): ${mail.subject}`);
  } catch (e) {
    mailFailed = true;
    log(`Email NOT sent: ${e.message}`);
    // Un-mark the ads problems so the next run tries the email again.
    for (const a of alerts) if (state.ads?.open) delete state.ads.open[a.key];
    if (state.activationFails === 3) state.activationFails = 2;
  }
}

/* 4. Page + state */
const actView = act && !act.error && !act.disabled
  ? { ...act, activatedNow: act.activated.length, lastActivated: state.activationHistory || [], waiting: Object.entries(state.activation || {}).map(([sku, v]) => ({ sku, title: v.title, error: v.lastError })) }
  : act;
const model = { ads, act: actView, runAt: now, tz: TZ };
const out = PREVIEW ? join(ROOT, 'preview') : ROOT;
writeFile(join(out, 'BUDGET.md'), renderMarkdown(model));
writeFile(join(out, 'docs', 'index.html'), renderHtml(model));
state.lastRunAt = new Date(now).toISOString();
if (!PREVIEW) writeFile(STATE_FILE, JSON.stringify(state, null, 2) + '\n');
log(PREVIEW ? 'Preview written to preview/.' : 'Budget page and state saved.');
if (mailFailed) process.exit(1);
