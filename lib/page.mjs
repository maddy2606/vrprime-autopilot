// Renders the budget page (BUDGET.md, which GitHub shows in a private repo, and docs/index.html
// for GitHub Pages) and the alert emails.

import { rupees, plural, mdCell, esc, formatter, ago } from './util.mjs';

const typeLabel = t => (t === 'daily' ? 'Daily' : t === 'total' ? 'Total' : t || '–');
const status = x => (x.out ? '🔴 Out of budget' : '🟠 Running out');
const bar = pct => (pct === null ? '' : '█'.repeat(Math.round(pct / 10)) + '░'.repeat(10 - Math.round(pct / 10)));

function headline(ads) {
  if (!ads.checkedAt) return 'No Flipkart Ads reading yet.';
  if (ads.stale) return `⚠️ Ads data is old (last read ${ago(ads.ageMin * 6e4)} ago). The Mac reader may be off.`;
  if (!ads.ok) return `⚠️ ${ads.error}`;
  if (!ads.outCount && !ads.nearCount) return '✅ No campaign is out of budget or running out.';
  return `${ads.outCount ? `🔴 ${plural(ads.outCount, 'campaign')} out of budget` : '✅ None out of budget'}${ads.nearCount ? `, 🟠 ${ads.nearCount} running out` : ''}.`;
}

export function renderMarkdown({ ads, act, runAt, tz }) {
  const f = formatter(tz);
  const L = [];
  L.push('# VRPRIME · Flipkart Ads budget', '');
  L.push(`**${headline(ads)}**`, '');
  L.push(`Page updated ${f(runAt)} (every 30 min). Ads data read ${ads.checkedAt ? f(ads.checkedAt) : 'never'}.`, '');
  if (ads.wallet) {
    const w = ads.wallet;
    L.push('## Ad wallet', '', '| Balance | Spend, last ' + (w.days || 7) + ' days | Average per day | Days left |', '|--:|--:|--:|--:|');
    L.push(`| ${rupees(w.balance)} | ${rupees(w.spend7d)} | ${rupees(w.dailySpend)} | ${w.daysLeft ?? '–'}${ads.walletLow ? ' 🔴' : ''} |`, '');
    if (ads.walletLow) L.push(`> 🔴 Under ${ads.walletMinDays} days of spend left. Top up the ad wallet.`, '');
  }
  L.push('## Campaigns out of budget or running out', '');
  if (!ads.campaigns.length) L.push(ads.ok ? 'None. Flipkart\'s **Budget Exhausting** list is empty.' : 'Not available.', '');
  else {
    L.push('| Status | Campaign | Budget | Type | Remaining | Used | Since |', '|---|---|--:|---|--:|---|---|');
    for (const x of ads.campaigns) {
      const since = ads.open[`oob:${x.name}`];
      L.push(`| ${status(x)} | ${mdCell(x.name)} | ${rupees(x.budget)} | ${typeLabel(x.budgetType)} | ${rupees(x.remaining)} | ${x.usedPct === null ? '–' : `\`${bar(x.usedPct)}\` ${x.usedPct}%`} | ${since ? f(since) : ''} |`);
    }
    L.push('', `Flipkart lists ${plural(ads.total, 'campaign')} in **Budget Exhausting**. Daily budgets reset at midnight; raise a budget in Seller Hub > Ads > Campaign Manager.`, '');
  }
  if (ads.events.length) {
    L.push('## Recent budget events', '', '| When | Campaign | What |', '|---|---|---|');
    for (const e of ads.events.slice(0, 15)) L.push(`| ${f(e.at)} | ${mdCell(e.name)} | ${e.type === 'out_of_budget' ? `🔴 Out of budget (${rupees(e.budget)} ${e.budgetType || ''})` : '✅ Back in budget'} |`);
    L.push('');
  }
  L.push('## Listing auto-activation', '');
  L.push(activationLine(act), '');
  if (act?.lastActivated?.length) {
    L.push('| Activated | SKU | Product |', '|---|---|---|');
    for (const h of act.lastActivated.slice(0, 15)) L.push(`| ${f(h.at)} | \`${mdCell(h.sku)}\` | ${mdCell(h.title).slice(0, 70)} |`);
    L.push('');
  }
  if (act?.waiting?.length) {
    L.push(`**${plural(act.waiting.length, 'listing')} Flipkart wouldn't activate** (retried every few hours; Seller Hub > Listings shows the reason):`, '', '| SKU | Product | Flipkart said |', '|---|---|---|');
    for (const w of act.waiting.slice(0, 30)) L.push(`| \`${mdCell(w.sku)}\` | ${mdCell(w.title).slice(0, 60)} | ${mdCell(w.error).slice(0, 140)} |`);
    L.push('');
  }
  return L.join('\n') + '\n';
}

function activationLine(act) {
  if (!act) return 'Not run yet.';
  if (act.error) return `⚠️ Last run failed: ${act.error}`;
  if (act.disabled) return 'Turned off in config.json.';
  if (act.noList) return act.readyError ? `⚠️ Couldn't read the Ready for Activation tab: ${act.readyError} Nothing activated.` : `Waiting for a fresh Ready for Activation list from the Mac (${act.readyCheckedAt ? 'last one is too old' : 'none yet'}). Nothing activated.`;
  const parts = [`Ready for Activation tab: ${plural(act.listed, 'listing')}`];
  if (act.alreadyActive) parts.push(`${act.alreadyActive} already active`);
  if (act.activatedNow) parts.push(`activated ${act.activatedNow} this run${act.dryRun ? ' (dry run, nothing changed)' : ''}`);
  if (act.archived) parts.push(`${act.archived} archived (left alone)`);
  if (act.notFound) parts.push(`${act.notFound} not found on Flipkart`);
  if (act.ignored) parts.push(`${act.ignored} on the ignore list`);
  return parts.join(', ') + '.';
}

export function renderHtml(model) {
  const { ads, act, runAt, tz } = model;
  const f = formatter(tz);
  const rows = ads.campaigns.map(x => `<tr class="${x.out ? 'out' : 'near'}"><td><span class="pill">${x.out ? 'Out of budget' : 'Running out'}</span></td><td>${esc(x.name)}</td><td class="n">${rupees(x.budget)}</td><td>${typeLabel(x.budgetType)}</td><td class="n">${rupees(x.remaining)}</td><td><div class="meter"><i style="width:${x.usedPct ?? 0}%"></i></div><small>${x.usedPct ?? '–'}%</small></td></tr>`).join('');
  const w = ads.wallet;
  const tiles = w ? [
    ['Wallet balance', rupees(w.balance)], [`Spend, ${w.days || 7} days`, rupees(w.spend7d)], ['Average per day', rupees(w.dailySpend)], ['Days of spend left', `${w.daysLeft ?? '–'}`, ads.walletLow],
  ].map(([k, v, bad]) => `<div class="tile${bad ? ' bad' : ''}"><small>${k}</small><b>${v}</b></div>`).join('') : '';
  const events = ads.events.slice(0, 15).map(e => `<li><time>${f(e.at)}</time> ${esc(e.name)} — ${e.type === 'out_of_budget' ? `<span class="r">out of budget</span>` : '<span class="g">back in budget</span>'}</li>`).join('');
  const acts = (act?.lastActivated || []).slice(0, 10).map(h => `<li><time>${f(h.at)}</time> <code>${esc(h.sku)}</code> ${esc(String(h.title).slice(0, 70))}</li>`).join('');
  const waits = (act?.waiting || []).slice(0, 20).map(x => `<li><code>${esc(x.sku)}</code> ${esc(String(x.title).slice(0, 50))} — <small>${esc(String(x.error).slice(0, 140))}</small></li>`).join('');
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta http-equiv="refresh" content="1800"><title>VRPRIME Ads Budget</title>
<style>
:root{--bg:#f7f7f5;--card:#fff;--ink:#1d1d1b;--mute:#6b6b66;--line:#e6e5e0;--red:#c8372d;--amber:#b86e00;--green:#2f7d4f}
@media (prefers-color-scheme:dark){:root{--bg:#141413;--card:#1e1e1c;--ink:#ecebe6;--mute:#a09f98;--line:#33322f;--red:#ff6b5e;--amber:#f0a838;--green:#5cc28a}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--ink);font:15px/1.5 system-ui,-apple-system,Segoe UI,sans-serif}
main{max-width:960px;margin:0 auto;padding:24px 16px 48px}h1{font-size:22px;margin:0 0 4px}h2{font-size:16px;margin:28px 0 10px}
.sub{color:var(--mute);font-size:13px}.head{font-size:17px;font-weight:600;margin:16px 0}
.tiles{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:10px}.tile{background:var(--card);border:1px solid var(--line);border-radius:10px;padding:12px}
.tile small{color:var(--mute);display:block}.tile b{font-size:20px;font-variant-numeric:tabular-nums}.tile.bad b{color:var(--red)}
.wrap{overflow-x:auto;background:var(--card);border:1px solid var(--line);border-radius:10px}table{border-collapse:collapse;width:100%;min-width:600px}
th,td{padding:9px 12px;border-bottom:1px solid var(--line);text-align:left;white-space:nowrap}th{font-size:12px;color:var(--mute);font-weight:600}td.n{text-align:right;font-variant-numeric:tabular-nums}
.pill{font-size:12px;font-weight:600;padding:2px 8px;border-radius:99px}.out .pill{color:var(--red);background:color-mix(in srgb,var(--red) 14%,transparent)}.near .pill{color:var(--amber);background:color-mix(in srgb,var(--amber) 14%,transparent)}
.meter{display:inline-block;width:80px;height:6px;background:var(--line);border-radius:3px;vertical-align:middle;margin-right:6px}.meter i{display:block;height:100%;background:var(--red);border-radius:3px}.near .meter i{background:var(--amber)}
ul{padding-left:18px}li{margin:4px 0}time{color:var(--mute);font-size:13px;margin-right:6px}.r{color:var(--red)}.g{color:var(--green)}code{font-size:13px}
</style></head><body><main>
<h1>VRPRIME · Flipkart Ads budget</h1>
<div class="sub">Page updated ${f(runAt)} · refreshes every 30 min · ads read ${ads.checkedAt ? f(ads.checkedAt) : 'never'}</div>
<div class="head">${esc(headline(ads))}</div>
${tiles ? `<div class="tiles">${tiles}</div>` : ''}
<h2>Campaigns out of budget or running out</h2>
${rows ? `<div class="wrap"><table><thead><tr><th>Status</th><th>Campaign</th><th>Budget</th><th>Type</th><th>Remaining</th><th>Used</th></tr></thead><tbody>${rows}</tbody></table></div>` : `<p class="sub">${ads.ok ? 'None. Flipkart’s Budget Exhausting list is empty.' : 'Not available.'}</p>`}
${events ? `<h2>Recent budget events</h2><ul>${events}</ul>` : ''}
<h2>Listing auto-activation</h2><p>${esc(activationLine(act))}</p>
${acts ? `<ul>${acts}</ul>` : ''}
${waits ? `<h2>Flipkart wouldn’t activate</h2><ul>${waits}</ul>` : ''}
</main></body></html>
`;
}

/** Email for new ads problems and/or listings activated this run. Returns { subject, html } or null. */
export function alertEmail({ alerts, ads, activation, failures, tz, pageUrl }) {
  if (!alerts.length && !activation.length && !failures.length) return null;
  const f = formatter(tz);
  const oob = alerts.filter(a => a.kind === 'out_of_budget');
  const other = alerts.filter(a => a.kind !== 'out_of_budget');
  const subj = [];
  if (oob.length) subj.push(oob.length === 1 ? `🔴 Out of budget: ${oob[0].campaign.name}` : `🔴 ${oob.length} Flipkart campaigns out of budget`);
  for (const a of other) subj.push(a.kind === 'wallet_low' ? '🔴 Ad wallet low' : a.kind === 'ads_stale' ? '⚠️ Ads not being checked' : '⚠️ Ads check failed');
  if (activation.length) subj.push(`✅ ${plural(activation.length, 'listing')} activated`);
  if (failures.length) subj.push(`⚠️ ${failures.length} couldn't be activated`);
  const li = items => `<ul>${items.join('')}</ul>`;
  const parts = [];
  if (oob.length) {
    parts.push('<h3 style="color:#c8372d">Campaigns out of budget</h3>' + li(oob.map(a => `<li><b>${esc(a.campaign.name)}</b> — ${a.campaign.budgetType} budget ${rupees(a.campaign.budget)}</li>`)));
    parts.push('<p>Raise the budget in Seller Hub &gt; Ads &gt; Campaign Manager. Daily budgets reset at midnight.</p>');
  }
  if (other.length) parts.push(li(other.map(a => `<li>${esc(a.text)}</li>`)));
  if (ads?.wallet && (oob.length || other.length)) parts.push(`<p>Ad wallet: ${rupees(ads.wallet.balance)} · about ${ads.wallet.daysLeft ?? '–'} days left at ${rupees(ads.wallet.dailySpend)}/day.</p>`);
  if (ads?.campaigns?.length && oob.length) parts.push(`<p>All campaigns out of budget right now: ${ads.campaigns.filter(x => x.out).map(x => esc(x.name)).join(', ')}.</p>`);
  if (activation.length) parts.push('<h3 style="color:#2f7d4f">Listings activated (were in Ready for Activation)</h3>' + li(activation.slice(0, 50).map(a => `<li><code>${esc(a.sku)}</code> ${esc(String(a.title).slice(0, 80))}</li>`)) + (activation.length > 50 ? `<p>…and ${activation.length - 50} more.</p>` : ''));
  if (failures.length) parts.push('<h3>Flipkart wouldn’t activate these (tried again every few hours)</h3>' + li(failures.slice(0, 30).map(a => `<li><code>${esc(a.sku)}</code> ${esc(String(a.title).slice(0, 60))} — ${esc(a.error)}</li>`)));
  parts.push(`<p style="color:#6b6b66;font-size:13px">VRPRIME Autopilot · ${f(Date.now())}${pageUrl ? ` · <a href="${esc(pageUrl)}">Budget page</a>` : ''}</p>`);
  return { subject: subj.join(' · ').slice(0, 180), html: `<div style="font:15px/1.5 system-ui,sans-serif;color:#1d1d1b">${parts.join('\n')}</div>` };
}
