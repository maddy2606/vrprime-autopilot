// Auto-activation: only the SKUs Seller Hub shows in Inactive > Ready for Activation (read in Chrome on
// the Mac and pushed as listings/ready.json) are set to ACTIVE. Flipkart's API can't tell that tab apart
// from other inactive listings, so without that list nothing is activated. Listings Flipkart has blocked also show as INACTIVE in the API; Flipkart
// refuses to activate those, so a failed SKU is retried only every few hours, not every run.

import { MAX_SKUS_PER_CALL } from './flipkart.mjs';

const HOUR = 36e5;
const isArchived = l => String(l?.archived_status || '').toUpperCase() === 'ARCHIVED';

/** The listing exactly as Flipkart returned it, minus read-only fields, with listing_status ACTIVE. */
export function buildPayload(listing, readOnlyFields = []) {
  const drop = new Set(readOnlyFields);
  const out = {};
  for (const [k, v] of Object.entries(listing || {})) {
    if (drop.has(k) || v === null || v === undefined) continue;
    out[k] = v;
  }
  out.listing_status = 'ACTIVE';
  return out;
}

/** Collects every error description found anywhere in a piece of Flipkart's answer. */
export function errorText(node, depth = 0) {
  if (!node || depth > 6) return [];
  if (Array.isArray(node)) return node.flatMap(n => errorText(n, depth + 1));
  if (typeof node !== 'object') return [];
  const own = [];
  if (Array.isArray(node.errors)) {
    for (const e of node.errors) {
      const d = typeof e === 'string' ? e : [e?.code, e?.description || e?.message].filter(Boolean).join(': ');
      if (d) own.push(d);
    }
  }
  const nested = Object.entries(node).filter(([k]) => k !== 'errors').flatMap(([, v]) => errorText(v, depth + 1));
  return [...own, ...nested];
}

/**
 * Reads Flipkart's per-SKU answer to an update. It has used a few shapes over time, so this
 * accepts { skus: {sku: {status}} }, { sku: {sku: {status}} } and { sku: {status} }.
 * Returns { sku: { ok: true|false|null, error } }; null means the answer didn't say.
 */
export function parseUpdateResult(resp, skus) {
  const holder = (resp && (resp.skus || resp.sku || resp.listings)) || resp || {};
  const out = {};
  for (const sku of skus) {
    const r = holder[sku];
    if (!r || typeof r !== 'object') { out[sku] = { ok: null, error: null }; continue; }
    const st = String(r.status || '').toUpperCase();
    const errs = errorText(r);
    out[sku] = { ok: st ? st === 'SUCCESS' : errs.length ? false : null, error: errs.join('; ').slice(0, 400) || null };
  }
  return out;
}

/** True when this SKU should be tried now (never tried, or the last failure is old enough). */
export function isDue(entry, now, retryHours) {
  if (!entry || !entry.lastFailAt) return true;
  return now - Date.parse(entry.lastFailAt) >= retryHours * HOUR;
}

/**
 * One activation pass. Mutates state.activation and returns a summary.
 *   client: { searchSkus, details, update }   (lib/flipkart.mjs)
 */
export async function runActivation({ client, state, cfg, now = Date.now(), log = () => {} }) {
  const c = { ignoreSkus: [], maxPerRun: 200, retryAfterFailureHours: 6, readOnlyFields: [], dryRun: false, ...cfg };
  const ignore = new Set(c.ignoreSkus.map(s => String(s).trim()));
  const nowIso = new Date(now).toISOString();
  const book = (state.activation ||= {});
  const history = (state.activationHistory ||= []);

  // onlySkus: the Ready for Activation list. Required: no list means nothing is activated.
  if (!Array.isArray(c.onlySkus)) throw new Error('No Ready for Activation list given; refusing to activate anything.');
  const listed = [...new Set(c.onlySkus.map(s => String(s).trim()).filter(Boolean))];
  const found = listed.length ? await client.details(listed) : {};
  // Double-check with Flipkart: only listings that really are inactive and not archived.
  const inactiveSkus = listed.filter(s => found[s] && String(found[s].listing_status || '').toUpperCase() === 'INACTIVE');
  const info = found;

  const summary = { listed: listed.length, notFound: listed.filter(s => !found[s]).length, alreadyActive: listed.filter(s => found[s] && !inactiveSkus.includes(s)).length, inactive: inactiveSkus.length, archived: 0, ignored: 0, waiting: [], tried: 0, activated: [], failed: [], newlyFailed: [], dryRun: !!c.dryRun };
  const ready = [];
  for (const sku of inactiveSkus) {
    const l = info[sku];
    if (!l) continue;
    if (isArchived(l)) { summary.archived++; continue; }
    if (ignore.has(sku.trim())) { summary.ignored++; continue; }
    if (!isDue(book[sku], now, c.retryAfterFailureHours)) {
      summary.waiting.push({ sku, title: l.product_title || '', error: book[sku].lastError });
      continue;
    }
    ready.push(sku);
  }

  // Forget SKUs that are no longer inactive (activated by hand, archived, or delisted).
  const stillInactive = new Set(inactiveSkus);
  for (const sku of Object.keys(book)) if (!stillInactive.has(sku)) delete book[sku];

  const todo = ready.slice(0, c.maxPerRun);
  summary.tried = todo.length;
  if (c.dryRun) {
    summary.activated = todo.map(sku => ({ sku, title: info[sku].product_title || '', dryRun: true }));
    return summary;
  }

  const answers = {};
  for (let i = 0; i < todo.length; i += MAX_SKUS_PER_CALL) {
    const batch = todo.slice(i, i + MAX_SKUS_PER_CALL);
    const payload = Object.fromEntries(batch.map(sku => [sku, buildPayload(info[sku], c.readOnlyFields)]));
    try {
      Object.assign(answers, parseUpdateResult(await client.update(payload), batch));
    } catch (e) {
      // A whole-batch refusal (e.g. 400) can be caused by one SKU: try each on its own.
      log(`Batch update refused (${e.message}); retrying one SKU at a time.`);
      for (const sku of batch) {
        try { Object.assign(answers, parseUpdateResult(await client.update({ [sku]: payload[sku] }), [sku])); }
        catch (e2) { answers[sku] = { ok: false, error: (e2.body ? errorText(safeJson(e2.body)).join('; ') : '') || e2.message }; }
      }
    }
  }

  // Flipkart's own listing status is the proof: read the SKUs back.
  const after = todo.length ? await client.details(todo) : {};
  for (const sku of todo) {
    const title = info[sku].product_title || '';
    const nowActive = String(after[sku]?.listing_status || '').toUpperCase() === 'ACTIVE';
    const ans = answers[sku] || { ok: null, error: null };
    if (nowActive) {
      delete book[sku];
      summary.activated.push({ sku, title });
      history.unshift({ at: nowIso, sku, title });
      continue;
    }
    const error = ans.error || (ans.ok ? 'Flipkart accepted the update but the listing is still inactive.' : 'Flipkart did not activate the listing (no reason given).');
    const prev = book[sku];
    book[sku] = { title, firstFailAt: prev?.firstFailAt || nowIso, lastFailAt: nowIso, tries: (prev?.tries || 0) + 1, lastError: error };
    summary.failed.push({ sku, title, error });
    if (!prev) summary.newlyFailed.push({ sku, title, error });
  }
  state.activationHistory = history.slice(0, 200);
  return summary;
}

function safeJson(s) { try { return JSON.parse(s); } catch { return null; } }
