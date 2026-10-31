// Small DOM + visual helpers shared by every screen.

const P = (d) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
const F = (d) => `<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">${d}</svg>`;

export const ICONS = {
  home: P('<path d="M4 10.5 12 4l8 6.5V19a1 1 0 0 1-1 1h-4.5v-5.5h-5V20H5a1 1 0 0 1-1-1z"/>'),
  compass: P('<circle cx="12" cy="12" r="8.5"/><path d="m15.5 8.5-2 5-5 2 2-5z"/>'),
  library: P('<path d="M5 4.5v15M9 4.5v15"/><path d="m13 5.2 3.9-1 3.6 14.6-3.9 1z"/>'),
  bookmark: P('<path d="M7 4h10a1 1 0 0 1 1 1v15l-6-4-6 4V5a1 1 0 0 1 1-1z"/>'),
  bookmarkFill: F('<path d="M7 3.5h10A1.5 1.5 0 0 1 18.5 5v15.8L12 16.5l-6.5 4.3V5A1.5 1.5 0 0 1 7 3.5z"/>'),
  play: F('<path d="M8 5.6v12.8a1 1 0 0 0 1.5.86l10.4-6.4a1 1 0 0 0 0-1.72L9.5 4.74A1 1 0 0 0 8 5.6z"/>'),
  pause: F('<rect x="6.5" y="5" width="4" height="14" rx="1.2"/><rect x="13.5" y="5" width="4" height="14" rx="1.2"/>'),
  back15: P('<path d="M4.5 12a7.5 7.5 0 1 0 2.2-5.3"/><path d="M4.5 3.5v3.7h3.7"/><text x="12" y="15.2" text-anchor="middle" font-size="7.2" font-weight="700" fill="currentColor" stroke="none" font-family="Figtree,sans-serif">15</text>'),
  fwd30: P('<path d="M19.5 12a7.5 7.5 0 1 1-2.2-5.3"/><path d="M19.5 3.5v3.7h-3.7"/><text x="12" y="15.2" text-anchor="middle" font-size="7.2" font-weight="700" fill="currentColor" stroke="none" font-family="Figtree,sans-serif">30</text>'),
  prev: F('<path d="M6 5.5a1 1 0 0 1 2 0v13a1 1 0 0 1-2 0zM18.5 6.1v11.8a1 1 0 0 1-1.55.83L9.3 13.2a1.4 1.4 0 0 1 0-2.4l7.65-5.53a1 1 0 0 1 1.55.83z"/>'),
  next: F('<path d="M18 5.5a1 1 0 0 0-2 0v13a1 1 0 0 0 2 0zM5.5 6.1v11.8a1 1 0 0 0 1.55.83l7.65-5.53a1.4 1.4 0 0 0 0-2.4L7.05 5.27a1 1 0 0 0-1.55.83z"/>'),
  down: P('<path d="m6 9.5 6 6 6-6"/>'),
  back: P('<path d="M14.5 5.5 8 12l6.5 6.5"/>'),
  list: P('<path d="M9 6.5h11M9 12h11M9 17.5h11"/><circle cx="4.5" cy="6.5" r=".9" fill="currentColor"/><circle cx="4.5" cy="12" r=".9" fill="currentColor"/><circle cx="4.5" cy="17.5" r=".9" fill="currentColor"/>'),
  heart: P('<path d="M12 19.5s-7.5-4.6-7.5-10A4.3 4.3 0 0 1 12 6.8a4.3 4.3 0 0 1 7.5 2.7c0 5.4-7.5 10-7.5 10z"/>'),
  heartFill: F('<path d="M12 20.4c-.2 0-.4 0-.5-.1C11.2 20 3.5 15.4 3.5 9.5A5 5 0 0 1 12 5.9a5 5 0 0 1 8.5 3.6c0 5.9-7.7 10.5-8 10.8-.1.1-.3.1-.5.1z"/>'),
  download: P('<path d="M12 4v11"/><path d="m7 10.5 5 5 5-5"/><path d="M5 19.5h14"/>'),
  check: P('<path d="m5 12.5 4.5 4.5L19 7.5"/>'),
  done: F('<circle cx="12" cy="12" r="9.5"/><path d="m7.8 12.3 2.9 2.9 5.5-5.6" stroke="#11192C" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"/>'),
  search: P('<circle cx="11" cy="11" r="6.5"/><path d="m16 16 4 4"/>'),
  sparkle: P('<path d="M12 3.5c.6 4.4 2.1 5.9 6.5 6.5-4.4.6-5.9 2.1-6.5 6.5-.6-4.4-2.1-5.9-6.5-6.5 4.4-.6 5.9-2.1 6.5-6.5z"/><path d="M18.5 15.5c.25 1.6.9 2.25 2.5 2.5-1.6.25-2.25.9-2.5 2.5-.25-1.6-.9-2.25-2.5-2.5 1.6-.25 2.25-.9 2.5-2.5z"/>'),
  moon: P('<path d="M19.5 14.6A7.5 7.5 0 0 1 9.4 4.5 7.5 7.5 0 1 0 19.5 14.6z"/>'),
  text: P('<path d="M4 6.5h16M4 12h11M4 17.5h14"/>'),
  close: P('<path d="m6.5 6.5 11 11m0-11-11 11"/>'),
  plus: P('<path d="M12 5v14M5 12h14"/>'),
  settings: P('<circle cx="12" cy="12" r="3"/><path d="M19.4 13.5a7.7 7.7 0 0 0 0-3l2-1.5-2-3.4-2.3.9a7.6 7.6 0 0 0-2.6-1.5L14.1 2.5h-4.2l-.4 2.5a7.6 7.6 0 0 0-2.6 1.5l-2.3-.9-2 3.4 2 1.5a7.7 7.7 0 0 0 0 3l-2 1.5 2 3.4 2.3-.9a7.6 7.6 0 0 0 2.6 1.5l.4 2.5h4.2l.4-2.5a7.6 7.6 0 0 0 2.6-1.5l2.3.9 2-3.4z"/>'),
  trash: P('<path d="M4.5 7h15M10 11v6M14 11v6M6.5 7l1 12.5h9L17.5 7M9.5 7V4.5h5V7"/>'),
  voice: P('<path d="M12 4v16M8 8v8M16 8v8M4 10.5v3M20 10.5v3"/>'),
  globe: P('<circle cx="12" cy="12" r="8.5"/><path d="M3.5 12h17M12 3.5c2.5 2.6 3.5 5.4 3.5 8.5s-1 5.9-3.5 8.5c-2.5-2.6-3.5-5.4-3.5-8.5s1-5.9 3.5-8.5z"/>'),
  more: F('<circle cx="6" cy="12" r="1.7"/><circle cx="12" cy="12" r="1.7"/><circle cx="18" cy="12" r="1.7"/>'),
};

export function icon(name) { return ICONS[name] || ''; }
export function hydrateIcons(root = document) {
  root.querySelectorAll('[data-icon]').forEach((n) => { if (!n.firstChild) n.innerHTML = icon(n.dataset.icon); });
}

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ESC[c]);

/** Tagged template that escapes interpolations unless wrapped with raw(). */
export function html(strings, ...vals) {
  let out = '';
  strings.forEach((s, i) => {
    out += s;
    if (i < vals.length) {
      const v = vals[i];
      if (v == null || v === false) return;
      if (Array.isArray(v)) out += v.map((x) => (x && x.__raw ? x.s : esc(x))).join('');
      else out += v && v.__raw ? v.s : esc(v);
    }
  });
  return { __raw: true, s: out };
}
export const raw = (s) => ({ __raw: true, s: String(s) });
export function render(root, tpl) { root.innerHTML = tpl.s ?? tpl; hydrateIcons(root); return root; }

/* ---------- Time ---------- */
export function fmtTime(sec) {
  sec = Math.max(0, Math.floor(sec || 0));
  const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
  return h ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}` : `${m}:${String(s).padStart(2, '0')}`;
}
export function fmtDuration(sec) {
  if (!sec) return '';
  const h = Math.floor(sec / 3600), m = Math.round((sec % 3600) / 60);
  return h ? `${h} h ${m} min` : `${Math.max(1, m)} min`;
}
export function greeting() {
  const h = new Date().getHours();
  return h < 5 ? 'Up late' : h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : h < 22 ? 'Good evening' : 'Good night';
}

/* ---------- Colors ---------- */
export function hashHue(str) {
  let h = 0;
  for (let i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) >>> 0;
  return h % 360;
}
function hsl2rgb(h, s, l) {
  s /= 100; l /= 100;
  const k = (n) => (n + h / 30) % 12, a = s * Math.min(l, 1 - l);
  const f = (n) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  return [Math.round(f(0) * 255), Math.round(f(8) * 255), Math.round(f(4) * 255)];
}
export function paletteFromSeed(seed) {
  const h = hashHue(seed || 'x');
  return [hsl2rgb(h, 48, 46), hsl2rgb((h + 40) % 360, 55, 52), hsl2rgb((h + 200) % 360, 40, 42)];
}

const paletteCache = new Map();
/** Pull three moody colours from a cover image; falls back to a seeded palette. */
export function extractPalette(src, seed) {
  if (!src) return Promise.resolve(paletteFromSeed(seed));
  if (paletteCache.has(src)) return Promise.resolve(paletteCache.get(src));
  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.decoding = 'async';
    const done = (p) => { paletteCache.set(src, p); resolve(p); };
    img.onload = () => {
      try {
        const c = document.createElement('canvas'); c.width = 24; c.height = 36;
        const x = c.getContext('2d', { willReadFrequently: true });
        x.drawImage(img, 0, 0, 24, 36);
        const d = x.getImageData(0, 0, 24, 36).data;
        const buckets = new Map();
        for (let i = 0; i < d.length; i += 4) {
          const r = d[i], g = d[i + 1], b = d[i + 2];
          const max = Math.max(r, g, b), min = Math.min(r, g, b);
          const sat = max ? (max - min) / max : 0, lum = (max + min) / 2;
          if (lum < 28 || lum > 235) continue;
          const key = `${r >> 5},${g >> 5},${b >> 5}`;
          const e = buckets.get(key) || { r: 0, g: 0, b: 0, n: 0, w: 0 };
          e.r += r; e.g += g; e.b += b; e.n++; e.w += 1 + sat * 3;
          buckets.set(key, e);
        }
        const top = [...buckets.values()].sort((a, b) => b.w - a.w).slice(0, 6)
          .map((e) => [e.r / e.n, e.g / e.n, e.b / e.n].map(Math.round));
        if (top.length < 2) return done(paletteFromSeed(seed));
        while (top.length < 3) top.push(top[0]);
        done([top[0], top[1], top[top.length > 3 ? 3 : 2]]);
      } catch { done(paletteFromSeed(seed)); }
    };
    img.onerror = () => done(paletteFromSeed(seed));
    img.src = src;
  });
}
export function applyAmbient(p, target = document.documentElement) {
  p.forEach((c, i) => target.style.setProperty(`--amb-${i + 1}`, c.join(' ')));
}

/* ---------- Covers ---------- */
export function coverHTML(book, opts = {}) {
  const seed = `${book.title}|${book.author}`;
  const h = hashHue(seed);
  const [r, g, b] = hsl2rgb(h, 40, 22);
  const bg = `linear-gradient(160deg, hsl(${h} 42% 34%), hsl(${(h + 30) % 360} 46% 18%) 70%)`;
  const img = book.cover
    ? `<img src="${esc(book.cover)}" alt="" loading="${opts.eager ? 'eager' : 'lazy'}" decoding="async" onload="this.classList.add('ok');this.previousElementSibling.style.opacity=0" onerror="this.remove()">`
    : '';
  return `<div class="cover" style="--tint:${r} ${g} ${b};background:${bg}">` +
    `<div class="gen" style="transition:opacity .3s"><div class="gt">${esc(book.title)}</div><div><div class="rule"></div><div class="ga">${esc(book.author || '')}</div></div></div>` +
    `${img}${opts.extra || ''}</div>`;
}

/* ---------- Toast ---------- */
let toastTimer;
export function toast(msg, action) {
  const t = document.getElementById('toast');
  t.innerHTML = `<span>${esc(msg)}</span>${action ? `<button>${esc(action.label)}</button>` : ''}`;
  if (action) t.querySelector('button').onclick = () => { action.run(); t.classList.remove('show'); };
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), action ? 6000 : 2600);
}

/* ---------- Bottom sheets ---------- */
export function sheet(build) {
  const root = document.getElementById('sheet-root');
  const scrim = document.createElement('div'); scrim.className = 'sheet-scrim';
  const s = document.createElement('div'); s.className = 'sheet'; s.setAttribute('role', 'dialog');
  root.append(scrim, s);
  const close = () => {
    scrim.classList.remove('open'); s.classList.remove('open');
    setTimeout(() => { scrim.remove(); s.remove(); }, 450);
    document.removeEventListener('keydown', onKey);
  };
  const onKey = (e) => { if (e.key === 'Escape') close(); };
  document.addEventListener('keydown', onKey);
  scrim.onclick = close;
  build(s, close);
  hydrateIcons(s);
  requestAnimationFrame(() => requestAnimationFrame(() => { scrim.classList.add('open'); s.classList.add('open'); }));
  // Drag down to dismiss.
  let y0 = null, dy = 0;
  s.addEventListener('touchstart', (e) => { if (s.scrollTop <= 0) { y0 = e.touches[0].clientY; dy = 0; } }, { passive: true });
  s.addEventListener('touchmove', (e) => {
    if (y0 == null) return; dy = Math.max(0, e.touches[0].clientY - y0);
    if (dy > 0) { s.style.transition = 'none'; s.style.transform = `translate3d(0,${dy}px,0)`; }
  }, { passive: true });
  s.addEventListener('touchend', () => {
    if (y0 == null) return; s.style.transition = ''; s.style.transform = '';
    if (dy > 110) close(); y0 = null;
  });
  return close;
}

export function haptic(ms = 8) { try { navigator.vibrate?.(ms); } catch { /* not supported */ } }

export function debounce(fn, ms) { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; }
