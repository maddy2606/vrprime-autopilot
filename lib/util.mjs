// Small shared helpers: environment, JSON files, HTTP with retries, and formatting.

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

function loadEnvFile(file) {
  if (!existsSync(file)) return {};
  const out = {};
  for (const line of readFileSync(file, 'utf8').split(/\r?\n/)) {
    if (/^\s*#/.test(line)) continue;
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (m) out[m[1]] = m[2].replace(/^(["'])(.*)\1$/, '$2');
  }
  return out;
}

/** On GitHub, secrets come from the environment. Locally, from .env here or one folder up. */
export function loadEnv() {
  return { ...loadEnvFile(join(ROOT, '..', '.env')), ...loadEnvFile(join(ROOT, '.env')), ...process.env };
}

export const readJson = (file, fallback) => (existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : fallback);
export function writeFile(file, text) {
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, text);
}

export const sleep = ms => new Promise(r => setTimeout(r, ms));

/** fetch with retries on network errors, 429 and 5xx. Never prints secrets or tokens. */
export async function http(url, { method = 'GET', headers = {}, body, tries = 3, timeoutMs = 40000 } = {}) {
  const host = new URL(url).host;
  let last;
  for (let attempt = 0; attempt < tries; attempt++) {
    if (attempt) await sleep(1500 * attempt);
    let res;
    try {
      res = await fetch(url, {
        method,
        headers: { Accept: 'application/json', ...(body ? { 'Content-Type': 'application/json' } : {}), ...headers },
        body: body ? JSON.stringify(body) : undefined,
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (e) { last = new Error(`Could not reach ${host} (${e.name}).`); continue; }
    const text = await res.text();
    if (res.status === 429 || res.status >= 500) { last = new Error(`${host} answered ${res.status} (busy or down).`); continue; }
    if (!res.ok) {
      const err = new Error(res.status === 401 || res.status === 403
        ? `${host} refused the request (${res.status}). Check the API keys.`
        : `${host} answered ${res.status}: ${text.slice(0, 300)}`);
      err.status = res.status;
      err.body = text.slice(0, 2000);
      throw err;
    }
    try { return text ? JSON.parse(text) : {}; } catch { throw new Error(`${host} sent a response that isn't JSON.`); }
  }
  throw last;
}

export function formatter(tz) {
  const dt = new Intl.DateTimeFormat('en-IN', { timeZone: tz, day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit', hour12: true });
  return d => dt.format(new Date(d));
}

/** ₹ with Indian digit grouping, no paise unless asked. */
export const rupees = (n, digits = 0) => (n === null || n === undefined || Number.isNaN(Number(n)))
  ? '–'
  : '₹' + Number(n).toLocaleString('en-IN', { minimumFractionDigits: digits, maximumFractionDigits: digits });

export const plural = (n, one, many = one + 's') => `${n} ${n === 1 ? one : many}`;
export const ago = ms => { const m = Math.max(0, ms) / 6e4; return m < 60 ? `${Math.round(m)} min` : m < 2880 ? `${Math.round(m / 60)} h` : `${Math.round(m / 1440)} days`; };
export const esc = s => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
export const mdCell = s => String(s ?? '').replace(/\s+/g, ' ').replace(/\|/g, '\\|').replace(/</g, '&lt;').trim();
