import { test } from 'node:test';
import assert from 'node:assert/strict';
import { evaluateAds } from '../lib/ads.mjs';

const t0 = Date.parse('2026-11-02T10:00:00Z');
const reading = (at, campaigns, wallet = { balance: 100000, spend7d: 70000, days: 7, dailySpend: 10000, daysLeft: 10 }) =>
  ({ checkedAt: new Date(at).toISOString(), ok: true, error: null, wallet, campaigns, total: campaigns.length });
const oob = (name, budget = 1000) => ({ name, remaining: 0, budget, budgetType: 'daily', live: true, problem: 'out_of_budget' });
const near = name => ({ name, remaining: 200, budget: 1000, budgetType: 'daily', live: true, problem: 'near_budget' });

test('alerts once when a campaign goes out of budget, not again while it stays out', () => {
  const state = {};
  const r1 = evaluateAds({ doc: reading(t0, [oob('A'), near('B')]), state, cfg: {}, now: t0 + 6e4 });
  assert.deepEqual(r1.alerts.map(a => a.key), ['oob:A']);
  assert.equal(r1.view.outCount, 1);
  assert.equal(r1.view.campaigns[1].usedPct, 80);
  const r2 = evaluateAds({ doc: reading(t0 + 30 * 6e4, [oob('A')]), state, cfg: {}, now: t0 + 31 * 6e4 });
  assert.equal(r2.alerts.length, 0);
});

test('comes back in budget, then out again next day: alerts again', () => {
  const state = {};
  evaluateAds({ doc: reading(t0, [oob('A')]), state, cfg: {}, now: t0 });
  evaluateAds({ doc: reading(t0 + 36e5, []), state, cfg: {}, now: t0 + 36e5 });
  assert.equal(state.ads.events[0].type, 'back_in_budget');
  const flap = evaluateAds({ doc: reading(t0 + 2 * 36e5, [oob('A')]), state, cfg: {}, now: t0 + 2 * 36e5 });
  assert.equal(flap.alerts.length, 0, 'within 6 h of recovering: shown, not re-emailed');
  evaluateAds({ doc: reading(t0 + 3 * 36e5, []), state, cfg: {}, now: t0 + 3 * 36e5 });
  const nextDay = evaluateAds({ doc: reading(t0 + 24 * 36e5, [oob('A')]), state, cfg: {}, now: t0 + 24 * 36e5 });
  assert.deepEqual(nextDay.alerts.map(a => a.key), ['oob:A']);
});

test('stale data alerts once and keeps campaign problems open', () => {
  const state = {};
  evaluateAds({ doc: reading(t0, [oob('A')]), state, cfg: {}, now: t0 });
  const r = evaluateAds({ doc: reading(t0, [oob('A')]), state, cfg: { staleMinutes: 75 }, now: t0 + 2 * 36e5 });
  assert.deepEqual(r.alerts.map(a => a.kind), ['ads_stale']);
  assert.ok(state.ads.open['oob:A']);
  const again = evaluateAds({ doc: reading(t0, [oob('A')]), state, cfg: {}, now: t0 + 3 * 36e5 });
  assert.equal(again.alerts.length, 0);
});

test('wallet low and signed-out errors alert', () => {
  const state = {};
  const r = evaluateAds({ doc: reading(t0, [], { balance: 5000, spend7d: 70000, days: 7, dailySpend: 10000, daysLeft: 0.5 }), state, cfg: {}, now: t0 });
  assert.deepEqual(r.alerts.map(a => a.kind), ['wallet_low']);
  const e = evaluateAds({ doc: { checkedAt: new Date(t0).toISOString(), ok: false, error: 'Chrome is signed out' }, state, cfg: {}, now: t0 + 6e4 });
  assert.deepEqual(e.alerts.map(a => a.kind), ['ads_error']);
});
