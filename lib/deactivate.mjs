// One-off: set these SKUs back to INACTIVE (used to undo listings activated by mistake).
// Only listings Flipkart currently shows as ACTIVE are changed; each is read back to confirm.

import { MAX_SKUS_PER_CALL } from './flipkart.mjs';
import { buildPayload, parseUpdateResult } from './activate.mjs';

export async function runDeactivation({ client, skus, readOnlyFields = [] }) {
  const list = [...new Set(skus.map(s => String(s).trim()).filter(Boolean))];
  const info = list.length ? await client.details(list) : {};
  const res = { deactivated: [], alreadyInactive: [], notFound: [], failed: [] };
  const todo = [];
  for (const sku of list) {
    const l = info[sku];
    if (!l) res.notFound.push(sku);
    else if (String(l.listing_status || '').toUpperCase() === 'ACTIVE') todo.push(sku);
    else res.alreadyInactive.push(sku);
  }
  const answers = {};
  for (let i = 0; i < todo.length; i += MAX_SKUS_PER_CALL) {
    const batch = todo.slice(i, i + MAX_SKUS_PER_CALL);
    const payload = skus => Object.fromEntries(skus.map(s => [s, buildPayload(info[s], readOnlyFields, 'INACTIVE')]));
    try {
      Object.assign(answers, parseUpdateResult(await client.update(payload(batch)), batch));
    } catch {
      // Flipkart refused the batch as a whole: try each SKU on its own.
      for (const s of batch) {
        try { Object.assign(answers, parseUpdateResult(await client.update(payload([s])), [s])); }
        catch (e) { answers[s] = { ok: false, error: e.message }; }
      }
    }
  }
  const after = todo.length ? await client.details(todo) : {};
  for (const sku of todo) {
    const title = info[sku].product_title || '';
    if (String(after[sku]?.listing_status || '').toUpperCase() === 'INACTIVE') res.deactivated.push({ sku, title });
    else res.failed.push({ sku, title, error: answers[sku]?.error || 'Still active after the update.' });
  }
  return res;
}
