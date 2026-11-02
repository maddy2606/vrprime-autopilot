// Flipkart Ads budget check. Flipkart Ads has no seller API, so ads/latest.json is written by the
// Chrome reader on the Mac (ads/read-ads.js + ads-push.mjs). This file decides what's wrong and
// what's new enough to email about.

const MIN = 6e4, HOUR = 36e5;

/**
 * Works out the open problems in this reading, compares them with the last run's, and returns
 * { view, alerts }. Mutates state.ads.
 *   alerts: [{ key, kind: 'out_of_budget'|'wallet_low'|'ads_error'|'ads_stale', text, campaign? }]
 */
export function evaluateAds({ doc, state, cfg, now = Date.now() }) {
  const c = { staleMinutes: 75, walletMinDays: 3, realertHours: 6, ...cfg };
  const ads = (state.ads ||= { open: {}, closedAt: {}, events: [] });
  ads.open ||= {}; ads.closedAt ||= {}; ads.events ||= [];
  const nowIso = new Date(now).toISOString();

  const checkedAt = doc?.checkedAt ? Date.parse(doc.checkedAt) : null;
  const ageMin = checkedAt ? Math.round((now - checkedAt) / MIN) : null;
  const stale = !doc || ageMin === null || ageMin > c.staleMinutes;

  const campaigns = (doc?.ok && Array.isArray(doc.campaigns) ? doc.campaigns : []).map(x => {
    const used = x.budget > 0 && x.remaining !== null && x.remaining !== undefined ? Math.min(100, Math.max(0, Math.round((1 - x.remaining / x.budget) * 100))) : null;
    return { ...x, usedPct: used, out: x.problem === 'out_of_budget' || (x.remaining !== null && x.remaining !== undefined && x.remaining <= 0) };
  }).sort((a, b) => (b.out - a.out) || ((b.usedPct ?? 0) - (a.usedPct ?? 0)) || a.name.localeCompare(b.name));

  const wallet = doc?.ok ? doc.wallet || null : null;
  const walletLow = !!(wallet && wallet.daysLeft !== null && wallet.daysLeft !== undefined && wallet.daysLeft < c.walletMinDays);

  // Problems in this reading. With stale data, campaign/wallet problems carry over unchanged.
  const problems = new Map();
  if (stale) {
    problems.set('stale', { kind: 'ads_stale', text: doc?.checkedAt ? `Flipkart Ads hasn't been read for ${fmtAge(ageMin)}. Check that the Mac is on, Chrome is open and signed in to Seller Hub, and the "Flipkart ads check" task is running.` : 'No Flipkart Ads reading yet. Set up the Chrome reader on the Mac (see README).' });
    for (const k of Object.keys(ads.open)) if (k.startsWith('oob:') || k === 'wallet') problems.set(k, null);
  } else if (!doc.ok) {
    problems.set('error', { kind: 'ads_error', text: doc.error || 'The Flipkart Ads check failed.' });
  } else {
    for (const x of campaigns.filter(x => x.out)) {
      problems.set(`oob:${x.name}`, { kind: 'out_of_budget', campaign: x, text: `${x.name}: out of budget (${x.budgetType} budget ₹${fmtNum(x.budget)}).` });
    }
    if (walletLow) problems.set('wallet', { kind: 'wallet_low', text: `Ad wallet is low: ₹${fmtNum(wallet.balance)} left, about ${wallet.daysLeft} days at ₹${fmtNum(wallet.dailySpend)}/day.` });
  }

  const alerts = [];
  for (const [key, p] of problems) {
    if (ads.open[key]) continue;
    ads.open[key] = nowIso;
    if (!p) continue;
    const closed = ads.closedAt[key] ? Date.parse(ads.closedAt[key]) : null;
    const quiet = closed && now - closed < c.realertHours * HOUR;
    if (p.kind === 'out_of_budget') ads.events.unshift({ at: nowIso, type: 'out_of_budget', name: p.campaign.name, budget: p.campaign.budget, budgetType: p.campaign.budgetType });
    if (!quiet) alerts.push({ key, ...p });
  }
  for (const key of Object.keys(ads.open)) {
    if (problems.has(key)) continue;
    if (key.startsWith('oob:')) ads.events.unshift({ at: nowIso, type: 'back_in_budget', name: key.slice(4) });
    delete ads.open[key];
    ads.closedAt[key] = nowIso;
  }
  for (const [k, t] of Object.entries(ads.closedAt)) if (now - Date.parse(t) > 7 * 24 * HOUR) delete ads.closedAt[k];
  ads.events = ads.events.slice(0, 100);

  const view = {
    checkedAt: doc?.checkedAt || null, ageMin, stale, ok: !!doc?.ok, error: doc?.ok ? null : doc?.error || null,
    wallet, walletLow, walletMinDays: c.walletMinDays,
    campaigns, outCount: campaigns.filter(x => x.out).length, nearCount: campaigns.filter(x => !x.out).length,
    total: doc?.total ?? campaigns.length, open: { ...ads.open }, events: ads.events.slice(0, 30),
  };
  return { view, alerts };
}

const fmtNum = n => (n === null || n === undefined ? '–' : Number(n).toLocaleString('en-IN', { maximumFractionDigits: 0 }));
const fmtAge = m => (m === null ? 'a while' : m < 120 ? `${m} min` : m < 2880 ? `${Math.round(m / 60)} hours` : `${Math.round(m / 1440)} days`);
