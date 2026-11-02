import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runDeactivation } from '../lib/deactivate.mjs';

const L = () => ({
  A: { sku_id: 'A', product_title: 'a', listing_status: 'ACTIVE', price: { mrp: 1 } },
  B: { sku_id: 'B', product_title: 'b', listing_status: 'INACTIVE' },
  C: { sku_id: 'C', product_title: 'c', listing_status: 'ACTIVE' },
  X: { sku_id: 'X', product_title: 'x', listing_status: 'ACTIVE' },
});
function client(listings, { batchError = false, refuse = new Set() } = {}) {
  const updates = [];
  return {
    updates,
    async details(skus) { return Object.fromEntries(skus.filter(s => listings[s]).map(s => [s, structuredClone(listings[s])])); },
    async update(p) {
      updates.push(p);
      if (batchError && Object.keys(p).length > 1) throw new Error('400');
      const out = { skus: {} };
      for (const [s, v] of Object.entries(p)) {
        if (refuse.has(s)) { out.skus[s] = { status: 'FAILURE', errors: [{ description: 'nope' }] }; continue; }
        listings[s].listing_status = v.listing_status; out.skus[s] = { status: 'SUCCESS' };
      }
      return out;
    },
  };
}

test('sets only currently-active listings to INACTIVE and confirms', async () => {
  const l = L(), c = client(l);
  const r = await runDeactivation({ client: c, skus: ['A', 'B', 'C', 'GONE'], readOnlyFields: ['sku_id', 'product_title'] });
  assert.deepEqual(r.deactivated.map(x => x.sku), ['A', 'C']);
  assert.deepEqual(r.alreadyInactive, ['B']);
  assert.deepEqual(r.notFound, ['GONE']);
  assert.equal(l.A.listing_status, 'INACTIVE');
  assert.equal(c.updates[0].A.listing_status, 'INACTIVE');
  assert.equal(c.updates[0].A.product_title, undefined);
  assert.equal(l.X.listing_status, 'ACTIVE', 'not in the list: untouched');
});

test('batch refusal falls back to one at a time; refusals reported', async () => {
  const l = L(), c = client(l, { batchError: true, refuse: new Set(['C']) });
  const r = await runDeactivation({ client: c, skus: ['A', 'C'] });
  assert.deepEqual(r.deactivated.map(x => x.sku), ['A']);
  assert.equal(r.failed[0].sku, 'C');
  assert.match(r.failed[0].error, /nope/);
});
