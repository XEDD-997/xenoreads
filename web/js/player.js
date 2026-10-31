// Player: one controller, two engines (recorded audio, device voice), the full-screen
// sheet with the read-along view, the mini player, lock-screen controls and progress sync.

import * as store from './store.js';
import * as offline from './offline.js';
import { $, $$, icon, coverHTML, fmtTime, toast, sheet, haptic, extractPalette, applyAmbient, esc } from './ui.js';

const SPEEDS = [0.8, 1, 1.15, 1.25, 1.5, 1.75, 2];
const st = {
  book: null, ci: 0, lines: [], si: -1, playing: false, rate: store.settings().speed || 1,
  open: false, follow: true, sleepAt: 0, sleepEndOfChapter: false, lastSave: 0, palette: null,
};
const listeners = new Set();
export const onChange = (f) => { listeners.add(f); return () => listeners.delete(f); };
const changed = () => listeners.forEach((f) => f(st));
export const state = () => st;

/* ======================= Engines ======================= */

const audio = new Audio();
audio.preload = 'auto';
audio.crossOrigin = null;

const AudioEngine = {
  async load(ch, at = 0) {
    const src = await offline.playableUrl(ch.url);
    audio.src = src;
    audio.playbackRate = st.rate;
    if (at > 0) {
      await new Promise((r) => { const f = () => { audio.removeEventListener('loadedmetadata', f); r(); }; audio.addEventListener('loadedmetadata', f); setTimeout(r, 4000); });
      try { audio.currentTime = at; } catch { /* not seekable yet */ }
    }
  },
  play: () => audio.play(),
  pause: () => audio.pause(),
  time: () => audio.currentTime || 0,
  duration: () => (isFinite(audio.duration) && audio.duration) || st.book?.chapters[st.ci]?.dur || 0,
  seek: (t) => { audio.currentTime = Math.max(0, Math.min(t, AudioEngine.duration() - 0.2)); },
  rate: (r) => { audio.playbackRate = r; },
  stop: () => { audio.pause(); audio.removeAttribute('src'); audio.load(); },
};

// Device voice: one utterance per sentence, so highlighting is exact even where
// the browser gives no word-boundary events. Falls back to a timed simulation
// when no voice exists (headless browsers, some WebViews).
const SpeechEngine = (() => {
  const synth = window.speechSynthesis;
  let est = [], idx = 0, startedAt = 0, playing = false, timer = 0, voice = null, token = 0;
  const words = (t) => t.split(/\s+/).length;
  const pickVoice = () => {
    if (!synth) return null;
    const vs = synth.getVoices().filter((v) => /^en/i.test(v.lang));
    const rank = (v) => (/natural|neural|premium|enhanced/i.test(v.name) ? 3 : 0) + (/google|samantha|daniel|serena|aria|jenny|guy/i.test(v.name) ? 2 : 0) + (v.localService ? 0 : 1);
    return vs.sort((a, b) => rank(b) - rank(a))[0] || null;
  };
  synth?.addEventListener?.('voiceschanged', () => { voice = pickVoice(); });
  const hasVoice = () => !!synth && (voice ||= pickVoice());
  function build(lines) {
    let t = 0;
    est = lines.map((l) => { const d = Math.max(1.1, words(l.t) / 2.7) + (l.p ? 0.5 : 0.18); const o = { s: t, e: t + d }; t += d; return o; });
    lines.forEach((l, i) => { l.s = est[i].s; l.e = est[i].e; });
  }
  function speak(i) {
    const my = ++token;
    idx = i;
    if (i >= st.lines.length) { playing = false; onEnded(); return; }
    startedAt = performance.now();
    setSentence(i);
    const next = () => { if (my === token && playing) speak(i + 1); };
    if (hasVoice()) {
      const u = new SpeechSynthesisUtterance(st.lines[i].t);
      u.voice = voice; u.lang = voice.lang; u.rate = st.rate;
      u.onend = next;
      u.onerror = (e) => { if (e.error !== 'interrupted' && e.error !== 'canceled') next(); };
      synth.speak(u);
    } else {
      timer = setTimeout(next, ((est[i].e - est[i].s) * 1000) / st.rate);
    }
  }
  return {
    async load(ch, at = 0) { this.stop(); build(st.lines); idx = this.indexAt(at); },
    indexAt(t) { let i = 0; while (i < est.length - 1 && est[i + 1].s <= t) i++; return i; },
    play() { playing = true; synth?.cancel(); speak(idx); return Promise.resolve(); },
    pause() { playing = false; token++; synth?.cancel(); clearTimeout(timer); },
    time() {
      if (!est.length) return 0;
      const base = est[Math.min(idx, est.length - 1)];
      if (!playing) return base.s;
      return Math.min(base.e, base.s + ((performance.now() - startedAt) / 1000) * st.rate);
    },
    duration: () => (est.length ? est[est.length - 1].e : 0),
    seek(t) { const was = playing; this.pause(); idx = this.indexAt(t); setSentence(idx); if (was) this.play(); },
    seekSentence(i) { const was = playing; this.pause(); idx = i; setSentence(i); if (was) this.play(); },
    rate() { if (playing) { this.pause(); this.play(); } },
    stop() { playing = false; token++; synth?.cancel(); clearTimeout(timer); },
    get playing() { return playing; },
  };
})();

const engine = () => (st.book?.kind === 'speech' ? SpeechEngine : AudioEngine);

/* ======================= Loading ======================= */

function parseSync(j) {
  if (!j) return [];
  const rows = j.s || j.sentences || [];
  return rows.map((r) => (Array.isArray(r) ? { s: r[0], e: r[1], t: r[2], p: !!(r[3] & 1), title: !!(r[3] & 2) } : r));
}

async function loadChapter(ci, at = 0) {
  const b = st.book;
  st.ci = Math.max(0, Math.min(ci, b.chapters.length - 1));
  const ch = b.chapters[st.ci];
  st.si = -1;
  if (b.kind === 'speech') {
    st.lines = ch.sentences.map((x) => ({ ...x }));
  } else {
    st.lines = [];
    renderLines();
    st.lines = parseSync(await offline.getJSON(ch.sync));
  }
  renderLines();
  await engine().load(ch, at);
  updateMeta();
  tick(true);
  changed();
}

export async function open(book, { chapter, pos, autoplay = true, show = true } = {}) {
  if (!book || !book.chapters?.length) return;
  const same = st.book?.key === book.key;
  if (!same) {
    const prog = store.find('progress', book.key);
    if (chapter == null && prog) { chapter = prog.chapter || 0; pos = prog.pos || 0; }
    engine().pause?.();
    if (st.book) SpeechEngine.stop();
    if (st.book && st.book.kind !== 'speech' && book.kind === 'speech') AudioEngine.stop();
    st.book = book;
    await loadChapter(chapter || 0, pos || 0);
    themeFor(book);
  } else if (chapter != null && chapter !== st.ci) {
    await loadChapter(chapter, pos || 0);
  } else if (pos != null) {
    engine().seek(pos);
  }
  if (show) openSheet();
  if (autoplay) play();
  showMini();
}

async function themeFor(book) {
  st.palette = await extractPalette(book.cover, `${book.title}|${book.author}`);
  applyAmbient(st.palette, $('#player'));
  applyAmbient(st.palette);
}
export const palette = () => st.palette;

/* ======================= Transport ======================= */

export async function play() {
  if (!st.book) return;
  try {
    await engine().play();
    st.playing = true;
  } catch (e) {
    st.playing = false;
    if (e?.name !== 'AbortError') toast('This chapter can’t play right now. Check your connection, or download it first.');
  }
  syncPlayState();
}
export function pause() { engine().pause(); st.playing = false; save(true); syncPlayState(); }
export const toggle = () => (st.playing ? pause() : play());
export function skip(sec) { const e = engine(); e.seek(e.time() + sec); tick(true); save(true); }
export async function chapter(delta) {
  const n = st.ci + delta;
  if (n < 0 || n >= st.book.chapters.length) { if (delta < 0) engine().seek(0); return; }
  const was = st.playing;
  engine().pause();
  await loadChapter(n, 0);
  if (was) play();
  save(true);
}
export function seekTo(t) { engine().seek(t); tick(true); }
export function seekSentence(i) {
  const l = st.lines[i];
  if (!l) return;
  if (st.book.kind === 'speech') SpeechEngine.seekSentence(i); else engine().seek(l.s + 0.01);
  setSentence(i); st.follow = true; $('.back-now').hidden = true; follow(true);
  if (!st.playing) play();
}
export function setRate(r) {
  st.rate = r; store.saveSettings({ speed: r }); engine().rate(r);
  $('[data-act="speed"]').textContent = `${String(r).replace(/^0/, '')}×`;
  posState();
}

function onEnded() {
  if (st.sleepEndOfChapter) { st.sleepEndOfChapter = false; setSleepLabel(); pause(); return; }
  if (st.ci < st.book.chapters.length - 1) {
    loadChapter(st.ci + 1, 0).then(play);
  } else {
    st.playing = false; syncPlayState();
    store.set('progress', st.book.key, { finished: true, chapter: st.ci, pos: 0, frac: 1 });
    toast(`You finished ${st.book.title}.`);
  }
}
audio.addEventListener('ended', onEnded);
audio.addEventListener('pause', () => { if (st.book?.kind !== 'speech' && st.playing && !audio.ended) { st.playing = false; syncPlayState(); save(true); } });
audio.addEventListener('play', () => { if (!st.playing) { st.playing = true; syncPlayState(); } });
audio.addEventListener('error', () => { if (audio.getAttribute('src')) { st.playing = false; syncPlayState(); toast('Couldn’t load this chapter. Check your connection.'); } });

/* ======================= Progress ======================= */

function overallFrac() {
  const b = st.book; if (!b) return 0;
  const t = engine().time();
  const durs = b.chapters.map((c) => c.dur || 0);
  const total = durs.reduce((a, x) => a + x, 0);
  if (!total) return (st.ci + (engine().duration() ? t / engine().duration() : 0)) / b.chapters.length;
  return Math.min(1, (durs.slice(0, st.ci).reduce((a, x) => a + x, 0) + t) / total);
}

export function save(force = false) {
  const b = st.book; if (!b || b.key.startsWith('demo') && !store.isDemo()) return;
  const now = Date.now();
  if (!force && now - st.lastSave < 15000) return;
  st.lastSave = now;
  const line = st.lines[st.si];
  store.set('progress', b.key, {
    title: b.title, author: b.author || '', cover: b.cover || '', chapter: st.ci,
    chapterTitle: b.chapters[st.ci]?.title || '', chapters: b.chapters.length,
    pos: Math.round(engine().time() * 10) / 10, snippet: line && !line.title ? line.t.slice(0, 280) : '',
    frac: Math.round(overallFrac() * 1000) / 1000, finished: false,
  }).catch(() => {});
}
document.addEventListener('visibilitychange', () => { if (document.hidden) save(true); });
window.addEventListener('pagehide', () => save(true));

export async function bookmark(i = st.si) {
  const b = st.book; if (!b) return;
  const l = st.lines[i];
  await store.add('bookmarks', {
    key: b.key, title: b.title, author: b.author || '', cover: b.cover || '', chapter: st.ci,
    chapterTitle: b.chapters[st.ci]?.title || '', pos: l ? l.s : engine().time(), sentence: l ? i : -1,
    text: l ? l.t : `${fmtTime(engine().time())} in ${b.chapters[st.ci]?.title || 'this chapter'}`,
  });
  haptic(14);
  if (l) { const n = $$('.line')[i]; n?.classList.remove('flash'); void n?.offsetWidth; n?.classList.add('flash'); }
  toast('Saved to your bookmarks.');
}

/* ======================= Sentence tracking ======================= */

function sentenceAt(t) {
  const L = st.lines; if (!L.length) return -1;
  let lo = 0, hi = L.length - 1;
  if (t < L[0].s) return 0;
  while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (L[mid].s <= t) lo = mid; else hi = mid - 1; }
  return lo;
}

function setSentence(i) {
  if (i === st.si) return;
  const nodes = track.children;
  const prev = st.si;
  if (prev >= 0 && nodes[prev]) nodes[prev].classList.remove('on');
  if (prev < 0 || i < prev) for (let k = Math.max(0, i); k < (prev < 0 ? nodes.length : prev + 1); k++) nodes[k]?.classList.remove('past');
  for (let k = Math.max(0, prev); k < i; k++) nodes[k]?.classList.add('past');
  if (nodes[i]) nodes[i].classList.add('on');
  st.si = i;
  const l = st.lines[i];
  const ml = $('.mini-line');
  if (ml && l && !l.title) ml.textContent = l.t;
  if (st.follow) follow();
}

/* ======================= Read-along view ======================= */

const box = $('.lyrics');
const track = $('.lyrics-track');
let offsets = [];
function renderLines() {
  const L = st.lines;
  track.innerHTML = L.map((l, i) => `<button class="line${l.p && i ? ' para' : ''}${l.title ? ' title' : ''}" data-i="${i}">${esc(l.t)}</button>`).join('');
  st.si = -1;
  measure();
  box.scrollTop = 0; scrollY = 0;
  const empty = $('.lyrics-empty');
  const b = st.book;
  if (!L.length && b) {
    empty.hidden = false;
    empty.innerHTML = b.source === 'lv'
      ? `<p class="h2">No read-along text yet</p><p>Open this book’s page and choose “Make read-along” to get the text in sync with this recording.</p>`
      : `<p class="h2">Loading the text…</p>`;
  } else empty.hidden = true;
}
function measure() { offsets = [...track.children].map((n) => [n.offsetTop, n.offsetHeight]); }
new ResizeObserver(() => { measure(); follow(true); }).observe(box);

let scrollY = 0, scrollTarget = 0, scrollRAF = 0, lastFrame = 0;
function follow(jump = false) {
  if (!offsets.length || st.si < 0 || !isReadVisible()) return;
  const [top, h] = offsets[st.si] || [0, 0];
  scrollTarget = Math.max(0, top - box.clientHeight * 0.36 + h / 2);
  if (jump) { cancelAnimationFrame(scrollRAF); scrollRAF = 0; scrollY = scrollTarget; box.scrollTop = scrollY; return; }
  scrollY = box.scrollTop;
  if (!scrollRAF) { lastFrame = performance.now(); scrollRAF = requestAnimationFrame(stepScroll); }
}
function stepScroll(now) {
  const dt = Math.min(0.05, (now - lastFrame) / 1000); lastFrame = now;
  scrollY += (scrollTarget - scrollY) * (1 - Math.exp(-dt * 7.5));
  if (Math.abs(scrollTarget - scrollY) < 0.5 || !st.follow) { scrollY = st.follow ? scrollTarget : scrollY; box.scrollTop = scrollY; scrollRAF = 0; return; }
  box.scrollTop = scrollY;
  scrollRAF = requestAnimationFrame(stepScroll);
}
const isReadVisible = () => st.open && (document.body.clientWidth >= 960 || $('#player').classList.contains('read'));

let idleTimer = 0;
function userScrolled() {
  if (!st.lines.length) return;
  st.follow = false; cancelAnimationFrame(scrollRAF); scrollRAF = 0;
  $('.back-now').hidden = false;
  clearTimeout(idleTimer);
  idleTimer = setTimeout(() => { st.follow = true; $('.back-now').hidden = true; follow(); }, 5000);
}
['wheel', 'touchmove'].forEach((ev) => box.addEventListener(ev, userScrolled, { passive: true }));
box.addEventListener('keydown', (e) => { if (['ArrowUp', 'ArrowDown', 'PageUp', 'PageDown'].includes(e.key)) userScrolled(); });
$('.back-now').addEventListener('click', () => { st.follow = true; $('.back-now').hidden = true; clearTimeout(idleTimer); follow(); });

// Tap a sentence to jump there; hold to bookmark it.
let pressTimer = 0, pressed = false;
track.addEventListener('pointerdown', (e) => {
  const n = e.target.closest('.line'); if (!n) return;
  pressed = false;
  pressTimer = setTimeout(() => { pressed = true; bookmark(+n.dataset.i); }, 520);
});
['pointerup', 'pointercancel', 'pointerleave'].forEach((ev) => track.addEventListener(ev, () => clearTimeout(pressTimer)));
track.addEventListener('touchmove', () => clearTimeout(pressTimer), { passive: true });
track.addEventListener('click', (e) => {
  const n = e.target.closest('.line'); if (!n || pressed) return;
  seekSentence(+n.dataset.i);
});
track.addEventListener('contextmenu', (e) => e.preventDefault());

/* ======================= Frame loop ======================= */

let raf = 0, lastSec = -1;
const scrub = $('.scrub'), fill = $('.scrub-fill'), knob = $('.scrub-knob');
const tCur = $('.t-cur'), tLeft = $('.t-left'), miniBar = $('.mini-progress span');
let dragging = false;

function tick(force = false) {
  const e = engine();
  const t = e.time(), d = e.duration() || 1;
  if (st.book?.kind !== 'speech' && st.lines.length) { const i = sentenceAt(t); if (i !== st.si) setSentence(i); }
  if (!dragging) paintScrub(t / d);
  const sec = Math.floor(t);
  if (force || sec !== lastSec) {
    lastSec = sec;
    if (!dragging) { tCur.textContent = fmtTime(t); tLeft.textContent = `-${fmtTime(d - t)}`; }
    if (st.sleepAt && Date.now() >= st.sleepAt) { st.sleepAt = 0; setSleepLabel(); pause(); toast('Sleep timer ended. Paused.'); }
    else if (st.sleepAt) setSleepLabel();
    if (st.playing) save();
    if (sec % 5 === 0) posState();
  }
}
function paintScrub(f) {
  f = Math.max(0, Math.min(1, f || 0));
  fill.style.transform = `scaleX(${f})`;
  knob.style.transform = `translateX(${f * scrub.clientWidth}px)`;
  miniBar.style.transform = `scaleX(${f})`;
}
function loop() { tick(); raf = (st.playing || dragging) ? requestAnimationFrame(loop) : 0; }
function ensureLoop() { if (!raf) raf = requestAnimationFrame(loop); }

// Scrubbing
function fracAt(x) { const r = scrub.getBoundingClientRect(); return Math.max(0, Math.min(1, (x - r.left) / r.width)); }
scrub.addEventListener('pointerdown', (e) => {
  dragging = true; scrub.classList.add('active'); scrub.setPointerCapture(e.pointerId);
  const f = fracAt(e.clientX); paintScrub(f); tCur.textContent = fmtTime(f * engine().duration()); ensureLoop();
});
scrub.addEventListener('pointermove', (e) => {
  if (!dragging) return;
  const f = fracAt(e.clientX); paintScrub(f);
  const d = engine().duration(); tCur.textContent = fmtTime(f * d); tLeft.textContent = `-${fmtTime(d - f * d)}`;
});
const endDrag = (e) => {
  if (!dragging) return;
  dragging = false; scrub.classList.remove('active');
  seekTo(fracAt(e.clientX) * engine().duration()); save(true);
};
scrub.addEventListener('pointerup', endDrag);
scrub.addEventListener('pointercancel', () => { dragging = false; scrub.classList.remove('active'); });
scrub.addEventListener('keydown', (e) => { if (e.key === 'ArrowRight') skip(10); if (e.key === 'ArrowLeft') skip(-10); });

/* ======================= Lock screen / media keys ======================= */

const cap = window.Capacitor;
const MS = cap?.isNativePlatform?.() ? (cap.Plugins?.MediaSession || cap.registerPlugin?.('MediaSession')) : null;
const webMS = !MS && 'mediaSession' in navigator ? navigator.mediaSession : null;

function updateMeta() {
  const b = st.book; if (!b) return;
  const meta = { title: b.chapters[st.ci]?.title || b.title, artist: b.author || '', album: b.title, artwork: b.cover ? [{ src: b.cover, sizes: '512x512', type: 'image/jpeg' }] : [] };
  try { if (MS) MS.setMetadata(meta); else if (webMS) webMS.metadata = new MediaMetadata(meta); } catch { /* ignore */ }
  $('.pw-book').textContent = b.title;
  $('.pw-chapter').textContent = b.chapters[st.ci]?.title || '';
  $('.pm-title').textContent = b.title;
  $('.pm-author').textContent = b.author || '';
  $('.player-cover').innerHTML = coverHTML(b, { eager: true });
  $('.mini-title').textContent = b.title;
  $('.mini-cover').innerHTML = coverHTML(b);
  $('.mini-line').textContent = b.chapters[st.ci]?.title || b.author || '';
}
function posState() {
  const e = engine(); const d = e.duration();
  if (!d || !isFinite(d)) return;
  const p = { duration: d, playbackRate: st.rate, position: Math.min(e.time(), d) };
  try { if (MS) MS.setPositionState(p); else webMS?.setPositionState?.(p); } catch { /* ignore */ }
}
function syncPlayState() {
  const playing = st.playing;
  $('.play-btn').innerHTML = icon(playing ? 'pause' : 'play');
  $('.play-btn').setAttribute('aria-label', playing ? 'Pause' : 'Play');
  $('.mini-play').innerHTML = icon(playing ? 'pause' : 'play');
  try { if (MS) MS.setPlaybackState({ playbackState: playing ? 'playing' : 'paused' }); else if (webMS) webMS.playbackState = playing ? 'playing' : 'paused'; } catch { /* ignore */ }
  posState();
  if (playing) ensureLoop();
  changed();
}
const handlers = {
  play: () => play(), pause: () => pause(),
  seekbackward: () => skip(-15), seekforward: () => skip(30),
  previoustrack: () => chapter(-1), nexttrack: () => chapter(1),
  seekto: (d) => { if (d?.seekTime != null) seekTo(d.seekTime); },
};
for (const [action, fn] of Object.entries(handlers)) {
  try { if (MS) MS.setActionHandler({ action }, fn); else webMS?.setActionHandler(action, fn); } catch { /* unsupported action */ }
}

/* ======================= Sheet UI ======================= */

const player = $('#player');
function openSheet() {
  if (st.open) return;
  st.open = true;
  player.classList.add('open'); player.setAttribute('aria-hidden', 'false');
  if (store.settings().view === 'read' && st.lines.length) player.classList.add('read');
  updateViewTool();
  history.pushState({ player: 1 }, '');
  requestAnimationFrame(() => { measure(); follow(true); });
  tick(true);
}
export function closeSheet(fromPop = false) {
  if (!st.open) return;
  st.open = false;
  player.classList.remove('open'); player.setAttribute('aria-hidden', 'true');
  if (!fromPop && history.state?.player) history.back();
}
export const show = () => { if (st.book) openSheet(); };
window.addEventListener('popstate', () => { if (st.open) closeSheet(true); });

function updateViewTool() {
  const read = player.classList.contains('read');
  const t = $('[data-act="view"]');
  t.classList.toggle('on', read);
  t.querySelector('span:last-child').textContent = read ? 'Cover' : 'Read along';
}

function showMini() {
  const m = $('#mini');
  if (m.hidden) { m.hidden = false; m.classList.add('enter'); }
}

function setSleepLabel() {
  const l = $('.sleep-label');
  const tool = $('[data-act="sleep"]');
  if (st.sleepEndOfChapter) { l.textContent = 'End of chapter'; tool.classList.add('on'); return; }
  if (!st.sleepAt) { l.textContent = 'Sleep'; tool.classList.remove('on'); return; }
  l.textContent = fmtTime(Math.max(0, (st.sleepAt - Date.now()) / 1000));
  tool.classList.add('on');
}

function chaptersSheet() {
  const b = st.book;
  sheet((s, close) => {
    s.innerHTML = `<p class="h2">${esc(b.title)}</p><p class="sub">${b.chapters.length} chapter${b.chapters.length === 1 ? '' : 's'}</p>
      <ul class="list">${b.chapters.map((c, i) => `<li><button class="ch${i === st.ci ? ' now' : ''}" data-i="${i}"><span class="n">${i + 1}</span><span class="t">${esc(c.title || `Chapter ${i + 1}`)}</span><span class="d">${c.dur ? fmtTime(c.dur) : ''}</span><span></span></button></li>`).join('')}</ul>`;
    s.addEventListener('click', async (e) => {
      const btn = e.target.closest('.ch'); if (!btn) return;
      close(); const was = st.playing || true; engine().pause();
      await loadChapter(+btn.dataset.i, 0); if (was) play();
    });
    requestAnimationFrame(() => s.querySelector('.now')?.scrollIntoView({ block: 'center' }));
  });
}

function sleepSheet() {
  const opts = [[0, 'Off'], [10, '10 minutes'], [20, '20 minutes'], [30, '30 minutes'], [45, '45 minutes'], [60, '1 hour'], [-1, 'End of this chapter']];
  sheet((s, close) => {
    s.innerHTML = `<p class="h2">Sleep timer</p><p class="sub">Playback pauses on its own.</p>` +
      opts.map(([m, label]) => `<button class="opt" data-m="${m}">${label}</button>`).join('');
    s.addEventListener('click', (e) => {
      const b = e.target.closest('.opt'); if (!b) return;
      const m = +b.dataset.m;
      st.sleepEndOfChapter = m === -1;
      st.sleepAt = m > 0 ? Date.now() + m * 60000 : 0;
      setSleepLabel(); close();
      if (m) toast(m === -1 ? 'Pausing at the end of this chapter.' : `Pausing in ${b.textContent}.`);
    });
  });
}

player.addEventListener('click', (e) => {
  const a = e.target.closest('[data-act]')?.dataset.act; if (!a) return;
  if (a === 'close') closeSheet();
  else if (a === 'toggle') { haptic(); toggle(); }
  else if (a === 'back') skip(-15);
  else if (a === 'fwd') skip(30);
  else if (a === 'prev') chapter(-1);
  else if (a === 'next') chapter(1);
  else if (a === 'chapters') chaptersSheet();
  else if (a === 'speed') setRate(SPEEDS[(SPEEDS.indexOf(st.rate) + 1) % SPEEDS.length]);
  else if (a === 'sleep') sleepSheet();
  else if (a === 'mark') bookmark();
  else if (a === 'view') {
    player.classList.toggle('read');
    store.saveSettings({ view: player.classList.contains('read') ? 'read' : 'cover' });
    updateViewTool();
    if (player.classList.contains('read')) requestAnimationFrame(() => { measure(); follow(true); });
  }
});

// Drag the sheet down to close it (from the header or the cover).
(() => {
  let y0 = null, dy = 0;
  const start = (e) => { if (e.target.closest('button')) return; y0 = e.touches[0].clientY; dy = 0; };
  const move = (e) => {
    if (y0 == null) return;
    dy = Math.max(0, e.touches[0].clientY - y0);
    if (dy > 4) { player.classList.add('dragging'); player.style.transform = `translate3d(0,${dy}px,0)`; }
  };
  const end = () => {
    if (y0 == null) return;
    player.classList.remove('dragging'); player.style.transform = '';
    if (dy > 120) closeSheet();
    y0 = null;
  };
  [$('.player-top'), $('.player-art')].forEach((n) => {
    n.addEventListener('touchstart', start, { passive: true });
    n.addEventListener('touchmove', move, { passive: true });
    n.addEventListener('touchend', end);
  });
})();

$('#mini').addEventListener('click', (e) => {
  if (e.target.closest('.mini-play')) { e.stopPropagation(); haptic(); toggle(); return; }
  openSheet();
});

// Keyboard on desktop
document.addEventListener('keydown', (e) => {
  if (!st.book || e.target.closest('input, textarea, select')) return;
  if (e.code === 'Space') { e.preventDefault(); toggle(); }
  else if (e.key === 'ArrowRight' && e.shiftKey) skip(30);
  else if (e.key === 'ArrowLeft' && e.shiftKey) skip(-15);
  else if (e.key === 'Escape' && st.open) closeSheet();
});

// Icons for static controls
$$('#player [data-act]').forEach((b) => {
  const map = { close: 'down', chapters: 'list', prev: 'prev', back: 'back15', toggle: 'play', fwd: 'fwd30', next: 'next' };
  if (map[b.dataset.act]) b.innerHTML = icon(map[b.dataset.act]);
});
$('.mini-play').innerHTML = icon('play');
$('[data-act="speed"]').textContent = `${String(st.rate).replace(/^0/, '')}×`;
