// Flipkart Seller API client. Only these requests are made:
//   GET  /oauth-service/oauth/token        get an access token
//   POST /sellers/listings/v3/search       list SKUs by status (changes nothing)
//   GET  /sellers/listings/v3/{skus}       read listing details, at most 10 SKUs a call
//   POST /sellers/listings/v3/update       update listings (used only to set listing_status to ACTIVE)

import { http as defaultHttp } from './util.mjs';

export const MAX_SKUS_PER_CALL = 10;

export function createClient({ base = 'https://api.flipkart.net', appId, appSecret, http = defaultHttp } = {}) {
  const FK = base.replace(/\/+$/, '');
  let token = null;

  async function auth() {
    if (token) return { Authorization: `Bearer ${token}` };
    if (!appId || !appSecret) throw new Error('FLIPKART_APP_ID and FLIPKART_APP_SECRET are not set. On GitHub: Settings > Secrets and variables > Actions.');
    const r = await http(`${FK}/oauth-service/oauth/token?grant_type=client_credentials&scope=Seller_Api`, {
      headers: { Authorization: 'Basic ' + Buffer.from(`${appId}:${appSecret}`).toString('base64') },
    });
    if (!r.access_token) throw new Error('Flipkart did not return an access token.');
    token = r.access_token;
    return { Authorization: `Bearer ${token}` };
  }

  /** All SKU ids with this listing status. */
  async function searchSkus(listingStatus) {
    const skus = [];
    let page = null, guard = 0;
    do {
      const r = await http(`${FK}/sellers/listings/v3/search`, { method: 'POST', headers: await auth(), body: { filters: { listing_status: listingStatus }, page_id: page } });
      for (const l of r.listings || []) if (l && l.sku_id) skus.push(String(l.sku_id));
      page = r.has_more && r.next_page_id ? r.next_page_id : null;
    } while (page && ++guard < 500);
    return [...new Set(skus)];
  }

  /** { sku: listing } for these SKUs (10 per call, 4 calls at a time). */
  async function details(skus) {
    const batches = [];
    for (let i = 0; i < skus.length; i += MAX_SKUS_PER_CALL) batches.push(skus.slice(i, i + MAX_SKUS_PER_CALL));
    const out = {};
    let next = 0;
    const headers = await auth();
    await Promise.all(Array.from({ length: Math.min(4, batches.length) }, async () => {
      while (next < batches.length) {
        const batch = batches[next++];
        const r = await http(`${FK}/sellers/listings/v3/${batch.map(encodeURIComponent).join(',')}`, { headers });
        Object.assign(out, r.available || {});
      }
    }));
    return out;
  }

  /** POST a { sku: listing } payload to the v3 update endpoint. Returns Flipkart's raw answer. */
  async function update(payload) {
    return http(`${FK}/sellers/listings/v3/update`, { method: 'POST', headers: await auth(), body: payload });
  }

  return { searchSkus, details, update };
}
