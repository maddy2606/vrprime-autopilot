import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runActivation, buildPayload, parseUpdateResult, isDue } from '../lib/activate.mjs';

const listing = (sku, extra = {}) => ({
  sku_id: sku, product_id: 'P' + sku, product_title: 'Title ' + sku, product_url: 'https://x', listing_status: 'INACTIVE',
  price: { mrp: 500, selling_price: 400, currency: 'INR' }, tax: { hsn: '3307', tax_code: 'GST_18' },
  locations: [{ id: 'LOC1', status: 'ENABLED', inventory: 5 }], archived_status: null, ...extra,
});

function fakeClient(listings, { refuse = new Set(), batchError = false } = {}) {
  const updates = [];
  return {
    updates,
    async searchSkus(st) { return Object.values(listings).filter(l => l.listing_status === st).map(l => l.sku_id); },
    async details(skus) { return Object.fromEntries(skus.filter(s => listings[s]).map(s => [s, structuredClone(listings[s])])); },
    async update(payload) {
      updates.push(payload);
      const skus = Object.keys(payload);
      if (batchError && skus.length > 1) { const e = new Error('400'); e.status = 400; throw e; }
      const res = { status: 'SUCCESS', skus: {} };
      for (const s of skus) {
        if (refuse.has(s)) res.skus[s] = { status: 'FAILURE', errors: [{ severity: 'ERROR', code: 'BLOCKED', description: 'Listing is blocked' }] };
        else { listings[s].listing_status = payload[s].listing_status; res.skus[s] = { status: 'SUCCESS', errors: [] }; }
      }
      return res;
    },
  };
}

const cfg = { readOnlyFields: ['sku_id', 'product_title', 'product_url', 'archived_status'], retryAfterFailureHours: 6 };

test('activates inactive listings, leaves archived and ignored alone', async () => {
  const L = { A: listing('A'), B: listing('B', { archived_status: 'ARCHIVED' }), C: listing('C'), D: listing('D', { listing_status: 'ACTIVE' }) };
  const client = fakeClient(L);
  const state = {};
  const s = await runActivation({ client, state, cfg: { ...cfg, ignoreSkus: ['C'] } });
  assert.deepEqual(s.activated.map(a => a.sku), ['A']);
  assert.equal(s.archived, 1);
  assert.equal(s.ignored, 1);
  assert.equal(L.A.listing_status, 'ACTIVE');
  assert.equal(L.B.listing_status, 'INACTIVE');
  assert.equal(L.C.listing_status, 'INACTIVE');
  const sent = client.updates[0].A;
  assert.equal(sent.listing_status, 'ACTIVE');
  assert.equal(sent.product_title, undefined);
  assert.equal(sent.archived_status, undefined);
  assert.deepEqual(sent.price, L.A.price);
  assert.equal(state.activationHistory[0].sku, 'A');
});

test('a refused SKU is recorded once and not retried until the back-off passes', async () => {
  const L = { A: listing('A'), X: listing('X') };
  const client = fakeClient(L, { refuse: new Set(['X']) });
  const state = {};
  const t0 = Date.parse('2026-11-02T10:00:00Z');
  const s1 = await runActivation({ client, state, cfg, now: t0 });
  assert.deepEqual(s1.activated.map(a => a.sku), ['A']);
  assert.deepEqual(s1.newlyFailed.map(a => a.sku), ['X']);
  assert.match(s1.failed[0].error, /blocked/i);

  const s2 = await runActivation({ client, state, cfg, now: t0 + 30 * 6e4 });
  assert.equal(s2.tried, 0);
  assert.equal(s2.waiting.length, 1);

  const s3 = await runActivation({ client, state, cfg, now: t0 + 7 * 36e5 });
  assert.equal(s3.tried, 1);
  assert.equal(s3.newlyFailed.length, 0, 'second failure is not "new"');
  assert.equal(state.activation.X.tries, 2);
});

test('whole-batch refusal falls back to one SKU at a time', async () => {
  const L = { A: listing('A'), B: listing('B'), X: listing('X') };
  const client = fakeClient(L, { refuse: new Set(['X']), batchError: true });
  const s = await runActivation({ client, state: {}, cfg });
  assert.deepEqual(s.activated.map(a => a.sku).sort(), ['A', 'B']);
  assert.deepEqual(s.failed.map(a => a.sku), ['X']);
});

test('dry run changes nothing', async () => {
  const L = { A: listing('A') };
  const client = fakeClient(L);
  const s = await runActivation({ client, state: {}, cfg: { ...cfg, dryRun: true } });
  assert.equal(client.updates.length, 0);
  assert.equal(s.activated.length, 1);
  assert.equal(L.A.listing_status, 'INACTIVE');
});

test('maxPerRun caps the number of listings touched', async () => {
  const L = Object.fromEntries(Array.from({ length: 25 }, (_, i) => [`S${i}`, listing(`S${i}`)]));
  const s = await runActivation({ client: fakeClient(L), state: {}, cfg: { ...cfg, maxPerRun: 12 } });
  assert.equal(s.tried, 12);
  assert.equal(s.activated.length, 12);
});

test('parseUpdateResult understands the answer shapes', () => {
  assert.deepEqual(parseUpdateResult({ skus: { A: { status: 'SUCCESS' } } }, ['A']).A.ok, true);
  assert.deepEqual(parseUpdateResult({ sku: { A: { status: 'FAILURE', errors: [{ code: 'E1', description: 'bad' }] } } }, ['A']).A, { ok: false, error: 'E1: bad' });
  assert.deepEqual(parseUpdateResult({ A: { status: 'success' } }, ['A']).A.ok, true);
  assert.deepEqual(parseUpdateResult({}, ['A']).A, { ok: null, error: null });
});

test('buildPayload and isDue', () => {
  assert.deepEqual(buildPayload({ a: 1, b: null, sku_id: 'x', listing_status: 'INACTIVE' }, ['sku_id']), { a: 1, listing_status: 'ACTIVE' });
  assert.equal(isDue(undefined, 0, 6), true);
  assert.equal(isDue({ lastFailAt: new Date(0).toISOString() }, 5 * 36e5, 6), false);
  assert.equal(isDue({ lastFailAt: new Date(0).toISOString() }, 6 * 36e5, 6), true);
});
