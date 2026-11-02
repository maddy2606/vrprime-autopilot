import { test } from 'node:test';
import assert from 'node:assert/strict';
import { inQuietHours } from '../lib/util.mjs';

const q = { from: '23:00', to: '08:00' };
const ist = s => Date.parse(`${s}+05:30`);
test('paused from 11 PM to 8 AM India time', () => {
  for (const t of ['2026-11-02T23:00', '2026-11-02T23:59', '2026-11-03T00:30', '2026-11-03T07:59']) assert.equal(inQuietHours(ist(t), 'Asia/Kolkata', q), true, t);
  for (const t of ['2026-11-02T08:00', '2026-11-02T12:00', '2026-11-02T22:42', '2026-11-02T22:59']) assert.equal(inQuietHours(ist(t), 'Asia/Kolkata', q), false, t);
  assert.equal(inQuietHours(ist('2026-11-03T01:00'), 'Asia/Kolkata', null), false);
});

import { lastPauseEnd } from '../lib/util.mjs';
import { evaluateAds } from '../lib/ads.mjs';

test('no false "ads not checked" alert first thing in the morning', () => {
  const now = ist('2026-11-03T08:12');
  const end = lastPauseEnd(now, 'Asia/Kolkata', q);
  assert.equal(end, ist('2026-11-03T08:00'));
  assert.equal(lastPauseEnd(ist('2026-11-02T22:42'), 'Asia/Kolkata', q), ist('2026-11-02T08:00'));
  const doc = { checkedAt: new Date(ist('2026-11-02T22:55')).toISOString(), ok: true, campaigns: [], wallet: null };
  const morning = evaluateAds({ doc, state: {}, cfg: { pauseEndedAt: end }, now });
  assert.equal(morning.view.stale, false);
  const later = evaluateAds({ doc, state: {}, cfg: { pauseEndedAt: end }, now: ist('2026-11-03T09:30') });
  assert.equal(later.view.stale, true, 'Mac still silent 90 min after the pause: alert');
});
