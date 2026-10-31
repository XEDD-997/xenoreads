// Offline downloads: chapter audio + read-along text saved in Cache Storage.
// Playback uses blob URLs, so seeking works offline without range-request tricks.

const CACHE = 'xr-media-v1';
const IDX = 'xr.downloads';
const subs = new Set();
const active = new Map(); // key -> { done, total, abort }

function readIdx() { try { return JSON.parse(localStorage.getItem(IDX) || '{}'); } catch { return {}; } }
function writeIdx(o) { localStorage.setItem(IDX, JSON.stringify(o)); subs.forEach((f) => f()); }
export const list = () => Object.entries(readIdx()).map(([key, v]) => ({ key, ...v })).sort((a, b) => b.at - a.at);
export const entry = (key) => readIdx()[key];
export const progress = (key) => active.get(key);
export const onChange = (f) => { subs.add(f); return () => subs.delete(f); };
const notify = () => subs.forEach((f) => f());

export async function has(url) {
  if (!url || !('caches' in window)) return false;
  const c = await caches.open(CACHE);
  return !!(await c.match(url));
}

const blobUrls = new Map();
/** A local blob URL when the file is downloaded, else the network URL. */
export async function playableUrl(url) {
  if (!url || !('caches' in window)) return url;
  if (blobUrls.has(url)) return blobUrls.get(url);
  try {
    const c = await caches.open(CACHE);
    const r = await c.match(url);
    if (!r) return url;
    const u = URL.createObjectURL(await r.blob());
    blobUrls.set(url, u);
    return u;
  } catch { return url; }
}

export async function getJSON(url) {
  if (!url) return null;
  try {
    if ('caches' in window) {
      const c = await caches.open(CACHE);
      const r = await c.match(url);
      if (r) return r.json();
    }
    const res = await fetch(url);
    return res.ok ? res.json() : null;
  } catch { return null; }
}

async function fetchBlob(url, signal) {
  try {
    const res = await fetch(url, { signal, mode: 'cors' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.blob();
  } catch (e) {
    if (signal.aborted) throw e;
    // Inside the Android app, native HTTP ignores browser CORS rules.
    const http = window.Capacitor?.Plugins?.CapacitorHttp;
    if (!http) throw e;
    const r = await http.get({ url, responseType: 'blob' });
    if (r.status >= 400) throw new Error(`HTTP ${r.status}`);
    const bin = atob(r.data);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return new Blob([bytes], { type: 'audio/mpeg' });
  }
}

export async function download(book) {
  if (active.has(book.key)) return;
  try { await navigator.storage?.persist?.(); } catch { /* best effort */ }
  const c = await caches.open(CACHE);
  const ctrl = new AbortController();
  const files = [];
  book.chapters.forEach((ch) => { if (ch.url) files.push(ch.url); if (ch.sync) files.push(ch.sync); });
  const state = { done: 0, total: files.length, abort: () => ctrl.abort(), error: null };
  active.set(book.key, state); notify();
  let bytes = 0;
  try {
    for (const url of files) {
      if (!(await c.match(url))) {
        const blob = await fetchBlob(url, ctrl.signal);
        bytes += blob.size;
        await c.put(url, new Response(blob, { headers: { 'Content-Type': blob.type || 'application/octet-stream' } }));
      }
      state.done++; notify();
    }
    const idx = readIdx();
    idx[book.key] = { title: book.title, author: book.author, cover: book.cover, files, bytes: (idx[book.key]?.bytes || 0) + bytes, at: Date.now() };
    writeIdx(idx);
  } catch (e) {
    state.error = e.name === 'AbortError' ? null : (e.message || 'Download failed');
    throw e;
  } finally {
    active.delete(book.key); notify();
  }
}

export async function remove(key) {
  const idx = readIdx();
  const e = idx[key];
  if (e && 'caches' in window) {
    const c = await caches.open(CACHE);
    await Promise.all(e.files.map((u) => { blobUrls.delete(u); return c.delete(u); }));
  }
  delete idx[key]; writeIdx(idx);
}

export async function usage() {
  try { const e = await navigator.storage.estimate(); return e.usage || 0; } catch { return 0; }
}
export function fmtBytes(b) {
  if (!b) return '0 MB';
  return b > 1e9 ? `${(b / 1e9).toFixed(1)} GB` : `${Math.max(1, Math.round(b / 1e6))} MB`;
}
