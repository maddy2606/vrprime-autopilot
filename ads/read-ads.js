// Runs inside the Seller Hub Campaign Manager page (Claude in Chrome, javascript_tool).
// Reads the ad wallet, the 7-day ad spend, and the "Budget Exhausting" campaign list that the page
// itself loads, and returns one compact line of JSON (the tool returns at most ~1,000 characters).
// Output: {"ok":1,"w":wallet,"s":spend,"d":days,"n":count,"c":[[name,remaining,budget,"D"|"T",live]]}
//     or: {"ok":0,"e":"signed_out"|"page_not_loaded"|"no_data"}
await (async () => {
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const text = () => (document.body ? document.body.innerText : '');
  const num = s => { const m = String(s ?? '').replace(/,/g, '').match(/\d+(\.\d+)?/); return m ? Number(m[0]) : null; };

  for (let i = 0; i < 40 && !/Available wallet balance/.test(text()); i++) await sleep(500);
  if (!/Available wallet balance/.test(text())) {
    const signedOut = /login/i.test(location.href) || /Login to your account|Login with|Forgot Password|Sign in/i.test(text().slice(0, 4000));
    return JSON.stringify({ ok: 0, e: signedOut ? 'signed_out' : 'page_not_loaded' });
  }

  const wallet = num((text().match(/Available wallet balance:\s*₹\s*([\d,]+(?:\.\d+)?)/) || [])[1]);
  const sp = text().match(/Ad Spends[\s\S]{0,40}?₹\s*([\d,.]+)\s*(K|L|Lac|Lakh|Cr|M)?/);
  const mult = { K: 1e3, L: 1e5, Lac: 1e5, Lakh: 1e5, Cr: 1e7, M: 1e6 };
  const spend = sp ? Math.round(num(sp[1]) * (mult[sp[2]] || 1)) : null;
  const range = text().match(/Showing data from (\d+)\w* (\w+) (\d{4}) to (\d+)\w* (\w+) (\d{4})/);
  const days = range ? Math.round((Date.parse(`${range[4]} ${range[5]} ${range[6]}`) - Date.parse(`${range[1]} ${range[2]} ${range[3]}`)) / 864e5) + 1 : 7;

  // Catch the page's own response for the Budget Exhausting list.
  window.__adsResp = [];
  if (!window.__adsHook) {
    window.__adsHook = true;
    const rj = Response.prototype.json, rt = Response.prototype.text;
    Response.prototype.json = async function () {
      const v = await rj.apply(this, arguments);
      try { if (/fed-ads\/api/.test(this.url)) window.__adsResp.push(v); } catch (e) {}
      return v;
    };
    Response.prototype.text = async function () {
      const v = await rt.apply(this, arguments);
      try { if (/fed-ads\/api/.test(this.url)) window.__adsResp.push(JSON.parse(v)); } catch (e) {}
      return v;
    };
  }
  const exhausting = [...document.querySelectorAll('[role=tab]')].find(el => el.offsetParent && /Budget Exhausting/.test(el.textContent))
    || [...document.querySelectorAll('label, button, div, span')].filter(el => el.offsetParent && el.textContent.trim() === 'Budget Exhausting')[0];
  if (!exhausting) return JSON.stringify({ ok: 0, e: 'no_data' });
  exhausting.click();

  const list = () => { for (const v of window.__adsResp) { const cl = v && v.data && v.data.getData && v.data.getData.businessAccount && v.data.getData.businessAccount.adAccount && v.data.getData.businessAccount.adAccount.campaignList; if (cl) return cl; } return null; };
  for (let i = 0; i < 40 && !list(); i++) await sleep(500);
  const cl = list();
  if (!cl) return JSON.stringify({ ok: 0, e: 'no_data' });

  const rows = (cl.list || []).map(c => [
    String(c.name || '').replace(/['"\\\r\n]/g, '').slice(0, 40),
    num(String(c.remainingBudget || '').split(/for/i)[0]),
    Number(c.budget) || 0,
    c.budgetType === 'DAILY_BUDGET' ? 'D' : 'T',
    c.status === 'LIVE' ? 1 : 0,
  ]).sort((a, b) => (a[1] ?? 0) - (b[1] ?? 0));
  const res = { ok: 1, w: wallet, s: spend, d: days, n: cl.count ?? rows.length, c: [] };
  for (const r of rows) { res.c.push(r); if (JSON.stringify(res).length > 900) { res.c.pop(); break; } }
  return JSON.stringify(res);
})()
