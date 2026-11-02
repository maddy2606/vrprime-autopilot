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

/** Minutes since midnight in this time zone. */
export function localMinutes(now, tz) {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-GB', { timeZone: tz, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(new Date(now)).map(x => [x.type, x.value]));
  return Number(p.hour) * 60 + Number(p.minute);
}

/** True inside the paused window, e.g. from "23:00" to "08:00" (may cross midnight). */
export function inQuietHours(now, tz, quiet) {
  if (!quiet || !quiet.from || !quiet.to) return false;
  const toMin = s => { const [h, m] = String(s).split(':').map(Number); return h * 60 + (m || 0); };
  const t = localMinutes(now, tz), a = toMin(quiet.from), b = toMin(quiet.to);
  return a <= b ? t >= a && t < b : t >= a || t < b;
}

/** When the paused window last ended (ms), or null when there's no pause. */
export function lastPauseEnd(now, tz, quiet) {
  if (!quiet || !quiet.to) return null;
  const [h, m] = String(quiet.to).split(':').map(Number);
  const diff = (localMinutes(now, tz) - (h * 60 + (m || 0)) + 1440) % 1440;
  return Math.floor(now / 6e4) * 6e4 - diff * 6e4;
}
