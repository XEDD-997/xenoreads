// Screens. Each view renders into #view and wires its own events.

import * as store from './store.js';
import * as catalog from './catalog.js';
import * as books from './books.js';
import * as player from './player.js';
import * as offline from './offline.js';
import * as narrate from './narrate.js';
import {
  $, html, raw, render, icon, coverHTML, fmtDuration, fmtTime, greeting, toast, sheet,
  debounce, esc,
} from './ui.js';


/* ---------- Shared bits ---------- */

function bookCard(w, opts = {}) {
  const key = w.key;
  const prog = store.find('progress', key);
  const dl = offline.entry(key);
  const narr = w.gbId ? store.find('narrations', `gb-${w.gbId}`) : null;
  let extra = '';
  if (prog && !prog.finished && prog.frac > 0.005) extra += `<span class="bar"><span style="transform:scaleX(${prog.frac})"></span></span>`;
  if (dl) extra += `<span class="badge" title="Downloaded">${icon('download')}</span>`;
  else if (narr?.status === 'ready') extra += `<span class="badge" title="AI narration ready">${icon('sparkle')}</span>`;
  return html`<a class="book" href="#/book/${key}">${raw(coverHTML(w, { extra, eager: opts.eager }))}<div class="bt">${w.title}</div><div class="ba">${w.author}</div></a>`;
}
const shelfRow = (title, list, link) => list.length ? html`
  <section class="section">
    <div class="section-head"><h2 class="h2">${title}</h2>${link ? raw(`<a href="${link}">See all</a>`) : ''}</div>
    <div class="shelf">${list.map((w) => bookCard(w))}</div>
  </section>` : '';

const stripTags = (s) => String(s || '').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#0?39;/g, "'").replace(/\s+/g, ' ').trim();
const asWork = (d) => catalog.get(d.key || d.id) || { key: d.key || d.id, title: d.title, author: d.author, cover: d.cover };

/* ---------- Sign in ---------- */

export function signIn(view) {
  document.body.classList.add('signed-out');
  const denied = store.wasDenied();
  render(view, html`
    <div class="signin"><form class="signin-card" autocomplete="on" novalidate>
      <h1 class="h-display">Xenoreads</h1>
      <p class="lead">Your private listening room for the classics, and anything you want read aloud.</p>
      <label class="field"><span>Email</span><input class="input" type="email" name="email" autocomplete="username" required></label>
      <label class="field"><span>Password</span><input class="input" type="password" name="password" autocomplete="current-password" required></label>
      <p class="err" aria-live="polite">${denied ? 'This account doesn’t have access to Xenoreads.' : ''}</p>
      <button class="btn primary" style="width:100%" data-go>Sign in</button>
      <div style="text-align:center;margin-top:16px"><button type="button" class="btn ghost small" data-reset>Forgot password?</button></div>
    </form></div>`);
  const form = view.querySelector('form');
  const err = form.querySelector('.err');
  form.querySelector('[data-reset]').addEventListener('click', async () => {
    const email = form.email.value.trim();
    if (!email) { err.textContent = 'Type your email first, then tap Forgot password.'; form.email.focus(); return; }
    try { await store.resetPassword(email); err.textContent = ''; toast(`If ${email} has an account, a reset link is on its way.`); }
    catch (e) { err.textContent = /network/.test(e.code || '') ? 'No connection. Try again when you’re online.' : 'That email address doesn’t look right.'; }
  });
  form.onsubmit = async (e) => {
    e.preventDefault();
    const email = form.email.value.trim(), pw = form.password.value;
    if (!email || !pw) { err.textContent = 'Enter your email and password.'; return; }
    const btn = form.querySelector('[data-go]'); btn.disabled = true;
    try { await store.signIn(email, pw); }
    catch (ex) {
      const code = ex.code || '';
      err.textContent = /invalid-email/.test(code) ? 'That email address doesn’t look right.'
        : /invalid|wrong|not-found|credential/.test(code) ? 'That email and password don’t match. Check both and try again.'
        : /too-many-requests/.test(code) ? 'Too many tries. Wait a few minutes, or reset your password.'
        : /network/.test(code) ? 'No connection. Connect to the internet to sign in the first time.'
        : `Sign-in failed (${code || ex.message}).`;
      btn.disabled = false;
    }
  };
}

/* ---------- Home ---------- */

export async function home(view, user) {
  await catalog.load();
  const draw = () => {
    const progress = store.get('progress').filter((p) => !p.finished && !p.dismissed).sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
    const hero = progress[0];
    const rest = progress.slice(1, 12).map(asWork);
    const shelf = store.get('shelf').sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0)).map(asWork);
    const ready = store.get('narrations').filter((n) => n.status === 'ready' && n.kind !== 'lv').map((n) => ({ ...asWork({ key: n.id, ...n }), key: n.kind === 'ar' ? n.id : (catalog.get(n.id)?.key || n.id) }));
    const counts = catalog.categoryCounts();
    const cats = catalog.CATEGORIES.map((c, i) => ({ ...c, i, n: counts[i] })).filter((c) => c.n).sort((a, b) => b.n - a.n).slice(0, 8);
    const initial = (user?.email || '?')[0].toUpperCase();
    render(view, html`
      <div class="wrap">
        <header class="topbar">
          <div><p class="greet">${greeting()}</p><div class="wordmark">Xenoreads</div></div>
          <a class="avatar" href="#/settings" aria-label="Settings">${initial}</a>
        </header>
        ${store.isDemo() ? html`<p class="note">Preview mode. Your library, progress and bookmarks stay on this device until you connect Firebase (see the setup guide).</p>` : ''}
        ${hero ? resumeCard(hero) : startCard()}
        ${shelfRow('Keep listening', rest)}
        ${shelfRow('Your library', shelf, '#/library')}
        ${shelfRow('Narrated for you', ready, '#/library?t=narrations')}
        <section class="section">
          <div class="section-head"><h2 class="h2">Browse by mood</h2><a href="#/explore">All books</a></div>
          <div class="cats">${cats.map((c) => html`<a class="cat" href="#/explore?c=${c.i}" style="--h:${c.hue}"><small>${c.n.toLocaleString()}</small><span>${c.name}</span></a>`)}</div>
        </section>
        ${shelfRow('Most loved classics', catalog.popular(20))}
        ${shelfRow('Mysteries for the commute', catalog.inCategory(1, 16), '#/explore?c=1')}
        ${shelfRow('Other worlds', catalog.inCategory(2, 16), '#/explore?c=2')}
        ${shelfRow('Something to think about', catalog.inCategory(9, 16), '#/explore?c=9')}
      </div>`);
    view.querySelector('[data-resume]')?.addEventListener('click', async (e) => {
      e.preventDefault();
      const b = await books.resolve(e.currentTarget.dataset.resume);
      if (books.playable(b)) player.open(b); else location.hash = `#/book/${e.currentTarget.dataset.resume}`;
    });
    view.querySelector('[data-demo]')?.addEventListener('click', async () => player.open(await books.resolve(books.DEMO_KEY)));
    view.querySelector('[data-dismiss]')?.addEventListener('click', (e) => {
      e.preventDefault(); e.stopPropagation();
      dismissProgress(e.currentTarget.dataset.dismiss);
    });
  };
  draw();
  return [store.watch('progress', draw), store.watch('shelf', draw), store.watch('narrations', draw)].reduce((a, f) => () => { a(); f(); }, () => {});
}

/** Take a book out of Continue listening; its position is kept if you play it again. */
export async function dismissProgress(key) {
  if (player.state().book?.key === key) player.closeMini();
  await store.set('progress', key, { dismissed: true });
  toast('Removed from Continue listening.', { label: 'Undo', run: () => store.set('progress', key, { dismissed: false }) });
}

function resumeCard(p) {
  const w = asWork(p);
  const where = p.chapters > 1 ? `Chapter ${p.chapter + 1} of ${p.chapters}` : (p.chapterTitle || '');
  return html`
    <a class="resume" href="#/book/${p.id}">
      <button class="icon-btn resume-x" data-dismiss="${p.id}" aria-label="Remove from Continue listening">${raw(icon('close'))}</button>
      ${raw(coverHTML({ ...w, cover: p.cover || w.cover, title: p.title, author: p.author }, { eager: true, sharp: true }))}
      <div class="meta">
        <p class="sub">${where}</p>
        <div class="rt">${p.title}</div>
        <p class="sub">${p.author}</p>
        ${p.snippet ? html`<p class="quote">${p.snippet}</p>` : html`<div style="height:14px"></div>`}
        <div class="progress"><span style="transform:scaleX(${p.frac || 0})"></span></div>
        <div style="display:flex;align-items:center;justify-content:space-between;margin-top:14px;gap:10px">
          <span class="small">${Math.round((p.frac || 0) * 100)}% listened</span>
          <button class="btn primary small" data-resume="${p.id}">${raw(icon('play'))}Resume</button>
        </div>
      </div>
    </a>`;
}

function startCard() {
  return html`
    <div class="resume" style="grid-template-columns:1fr">
      <div class="meta">
        <div class="rt">Start with a chapter of Austen</div>
        <p class="quote">It is a truth universally acknowledged, that a single man in possession of a good fortune, must be in want of a wife.</p>
        <div class="row-actions"><button class="btn primary" data-demo>${raw(icon('play'))}Play the sample</button><a class="btn" href="#/explore">Find a book</a></div>
      </div>
    </div>`;
}

/* ---------- Explore ---------- */

export async function explore(view, params) {
  await catalog.load();
  let q = params.get('q') || '', cat = params.has('c') ? +params.get('c') : -1, kind = params.get('k') || 'all', limit = 60;
  render(view, html`
    <div class="wrap">
      <header class="topbar"><h1 class="h1">Explore</h1><span class="small">${catalog.count().toLocaleString()} books</span></header>
      <div class="search"><span class="ico">${raw(icon('search'))}</span><input type="search" placeholder="Search titles and authors" value="${q}" enterkeyhint="search" aria-label="Search"></div>
      <div class="chips scroll" data-kind>
        <button class="chip" data-k="all">All books</button>
        <button class="chip" data-k="human">Read by people</button>
        <button class="chip" data-k="text">Can be narrated</button>
      </div>
      <div class="chips scroll" data-cats style="margin-top:8px">
        ${catalog.CATEGORIES.map((c, i) => html`<button class="chip" data-c="${i}">${c.name}</button>`)}
      </div>
      <div class="results section"></div>
    </div>`);
  const out = view.querySelector('.results');
  const input = view.querySelector('input');
  const sync = () => {
    view.querySelectorAll('[data-k]').forEach((b) => b.classList.toggle('on', b.dataset.k === kind));
    view.querySelectorAll('[data-c]').forEach((b) => b.classList.toggle('on', +b.dataset.c === cat));
    const p = new URLSearchParams(); if (q) p.set('q', q); if (cat >= 0) p.set('c', cat); if (kind !== 'all') p.set('k', kind);
    history.replaceState(history.state, '', `#/explore${p.toString() ? `?${p}` : ''}`);
  };
  const draw = () => {
    sync();
    const res = catalog.search(q, { cat, kind, limit: limit + 1 });
    const title = cat >= 0 ? catalog.CATEGORIES[cat].name : q ? `Results for “${q}”` : 'Most listened';
    render(out, res.length ? html`
      <div class="section-head"><h2 class="h2">${title}</h2></div>
      <div class="grid">${res.slice(0, limit).map((w) => bookCard(w))}</div>
      ${res.length > limit ? html`<div style="text-align:center;margin-top:28px"><button class="btn" data-more>Show more</button></div>` : ''}`
      : html`<div class="empty"><p class="h2">No books match “${q}”</p><p>Try an author’s surname, or a single word from the title.</p></div>`);
    out.querySelector('[data-more]')?.addEventListener('click', () => { limit += 60; draw(); });
  };
  input.addEventListener('input', debounce(() => { q = input.value; limit = 60; draw(); }, 110));
  view.querySelector('[data-kind]').addEventListener('click', (e) => { const b = e.target.closest('[data-k]'); if (b) { kind = b.dataset.k; limit = 60; draw(); } });
  view.querySelector('[data-cats]').addEventListener('click', (e) => {
    const b = e.target.closest('[data-c]'); if (!b) return;
    cat = cat === +b.dataset.c ? -1 : +b.dataset.c; limit = 60; draw();
  });
  draw();
  if (cat >= 0) view.querySelector(`[data-c="${cat}"]`)?.scrollIntoView({ inline: 'center', block: 'nearest' });
}

/* ---------- Book ---------- */

export async function book(view, key) {
  await catalog.load();
  render(view, html`<div class="wrap"><div class="book-hero"><div class="cover skeleton"></div><div><div class="skeleton" style="height:44px;width:70%"></div></div></div></div>`);
  let disposed = false;
  const draw = async () => {
    const b = await books.resolve(key);
    if (disposed) return;
    if (!b) {
      render(view, html`<div class="wrap"><div class="empty"><p class="h2">This book isn’t in your catalog</p><p>It may have been removed. Search for it again.</p><a class="btn" href="#/explore">Explore books</a></div></div>`);
      return;
    }
    const w = b.work || {};
    const isArticle = key.startsWith('ar-');
    const narr = isArticle ? b.narration : b.gbNarr || b.narration;
    const align = b.align;
    const shelfed = !!store.find('shelf', b.work?.key || key);
    const prog = store.find('progress', b.key);
    const dl = offline.entry(b.key);
    const dlp = offline.progress(b.key);
    const totalDur = b.chapters.reduce((a, c) => a + (c.dur || 0), 0) || w.dur || 0;
    const desc = stripTags(b.desc);

    const actions = [];
    if (books.playable(b)) {
      const label = prog && !prog.finished ? 'Resume' : 'Play';
      const what = b.source === 'lv' ? 'Read by a person' : b.kind === 'speech' ? 'Device voice' : 'AI voice';
      actions.push(html`<button class="btn primary" data-play>${raw(icon('play'))}${label}</button>`);
      if (isArticle && b.kind === 'speech') actions.push(html`<span class="small" style="align-self:center">${what}</span>`);
    }
    const narrBook = b.source === 'lv' ? books.asNarration(b) : null;
    if (narrBook) actions.push(html`<button class="btn" data-play-ai>${raw(icon('sparkle'))}Play AI narration</button>`);
    if (!isArticle && w.gbId && !narr) {
      actions.push(html`<button class="btn" data-narrate>${raw(icon('sparkle'))}Narrate with AI voice</button>`);
    }
    if (isArticle && narr && !narr.chapters?.length && narr.status !== 'queued' && narr.status !== 'working') {
      actions.push(html`<button class="btn" data-narrate-article>${raw(icon('sparkle'))}Narrate in HD</button>`);
    }
    if (store.isNative() && b.kind === 'audio' && b.chapters.length) {
      actions.push(dlp ? html`<button class="btn" data-cancel>${raw(icon('download'))}${Math.round((dlp.done / dlp.total) * 100)}%</button>`
        : dl ? html`<button class="btn" data-undl>${raw(icon('check'))}Downloaded</button>`
          : html`<button class="btn" data-dl>${raw(icon('download'))}Download</button>`);
    }
    if (!isArticle) actions.push(html`<button class="icon-btn" data-shelf aria-label="${shelfed ? 'Remove from library' : 'Save to library'}" style="background:rgba(243,236,214,.06)">${raw(icon(shelfed ? 'heartFill' : 'heart'))}</button>`);

    const notes = [];
    if (narr && ['queued', 'working', 'error'].includes(narr.status)) {
      const frac = narr.chaptersTotal ? narr.chaptersDone / narr.chaptersTotal : 0;
      notes.push(html`<div class="note"><div style="display:flex;justify-content:space-between;gap:12px;align-items:center"><span>${narrate.statusText(narr)}</span><span style="display:flex;gap:8px">${narr.status === 'error' ? html`<button class="btn small" data-retry="${narr.id}">Try again</button>` : ''}<button class="btn ghost small" data-cancel-narr="${narr.id}">${narr.status === 'error' ? 'Remove' : 'Cancel'}</button></span></div>${narr.status === 'working' ? html`<div class="progress" style="margin-top:10px"><span style="transform:scaleX(${frac})"></span></div>` : ''}${narr.status !== 'error' ? html`<p class="small" style="margin:8px 0 0">Finished chapters play as soon as they’re ready.</p>` : ''}</div>`);
    }
    if (b.source === 'lv') {
      if (!align) notes.push(html`<div class="note" style="display:flex;justify-content:space-between;gap:12px;align-items:center"><span>Want the text in sync with this recording?</span><button class="btn small" data-align>Make read-along</button></div>`);
      else if (align.status !== 'ready') notes.push(html`<div class="note" style="display:flex;justify-content:space-between;gap:12px;align-items:center"><span>${narrate.statusText(align)}</span><span style="display:flex;gap:8px">${align.status === 'error' ? html`<button class="btn small" data-retry="${align.id}">Try again</button>` : ''}<button class="btn ghost small" data-cancel-narr="${align.id}">${align.status === 'error' ? 'Remove' : 'Cancel'}</button></span></div>`);
    }
    if (b.kind === 'pending' && !narr && !w.gbId && !isArticle) notes.push(html`<div class="note">No recording or text source is available for this book.</div>`);

    const facts = [];
    if (totalDur) facts.push(html`<span><b>${fmtDuration(totalDur)}</b></span>`);
    if (b.chapters.length) facts.push(html`<span><b>${b.chapters.length}</b> chapters</span>`);
    if (b.source === 'lv') facts.push(html`<span>LibriVox recording</span>`);
    else if (b.source === 'tts') facts.push(html`<span>${b.chapters.length ? 'AI narration' : 'Text from Project Gutenberg'}</span>`);
    if (isArticle && narr?.site) facts.push(html`<span>${narr.site}</span>`);
    if (prog && !prog.finished) facts.push(html`<span><b>${Math.round((prog.frac || 0) * 100)}%</b> listened</span>`);

    const chapters = b.kind === 'speech' ? [] : b.chapters;
    render(view, html`
      <div class="wrap">
        <header class="topbar"><button class="icon-btn" data-back aria-label="Back">${raw(icon('back'))}</button>
          ${isArticle ? html`<button class="icon-btn" data-del-article aria-label="Delete article">${raw(icon('trash'))}</button>` : ''}</header>
        <div class="book-hero">
          ${raw(coverHTML(b, { eager: true, sharp: true }))}
          <div>
            <h1 class="h-display">${b.title}</h1>
            <p class="by">${b.author || ''}</p>
            <div class="facts">${facts}</div>
            <div class="row-actions">${actions}</div>
            ${prog && !prog.finished && !prog.dismissed && prog.frac > 0 ? html`<button class="btn ghost small" data-dismiss-prog style="margin-top:10px;color:var(--muted)">Remove from Continue listening</button>` : ''}
          </div>
        </div>
        ${notes.length ? html`<div class="section" style="display:grid;gap:10px">${notes}</div>` : ''}
        ${desc ? html`<section class="section"><p class="desc clamp">${desc}</p></section>` : ''}
        ${isArticle && narr?.url ? html`<section class="section"><a class="btn small" href="${narr.url}" target="_blank" rel="noopener">${raw(icon('globe'))}Open the original</a></section>` : ''}
        ${chapters.length ? html`
          <section class="section"><div class="section-head"><h2 class="h2">Chapters</h2></div>
          <ul class="list">${chapters.map((c, i) => html`<li><button class="ch${prog && prog.chapter === i && !prog.finished ? ' now' : ''}" data-ch="${i}">
            <span class="n">${i + 1}</span><span class="t">${c.title || `Chapter ${i + 1}`}</span><span class="d">${c.dur ? fmtTime(c.dur) : ''}</span>
            <span class="s">${c.sync ? raw(icon('text')) : ''}</span></button></li>`)}</ul></section>` : ''}
      </div>`);

    const on = (sel, fn) => view.querySelector(sel)?.addEventListener('click', fn);
    on('[data-back]', () => (history.length > 1 ? history.back() : (location.hash = '#/home')));
    on('[data-play]', () => player.open(b));
    on('[data-play-ai]', () => player.open(narrBook));
    view.querySelectorAll('[data-ch]').forEach((n) => n.addEventListener('click', () => player.open(b, { chapter: +n.dataset.ch, pos: 0 })));
    on('[data-shelf]', async () => {
      const k = b.work?.key || key;
      if (shelfed) { await store.remove('shelf', k); toast('Removed from your library.'); }
      else { await store.set('shelf', k, { title: b.title, author: b.author || '', cover: b.cover || '' }); toast('Saved to your library.'); }
    });
    on('[data-dl]', () => offline.download(b).then(() => toast(`${b.title} is available offline.`)).catch((e) => e?.name !== 'AbortError' && toast(`Download stopped: ${e.message}. Try again on Wi‑Fi.`)));
    on('[data-cancel]', () => offline.progress(b.key)?.abort());
    on('[data-undl]', () => confirmSheet(`Remove the download of ${b.title}?`, 'Remove download', async () => { await offline.remove(b.key); toast('Download removed.'); }));
    on('[data-narrate]', () => voiceSheet(async (voice) => {
      const kicked = await narrate.narrateGutenberg(w, voice);
      toast(kicked ? 'Narration started.' : 'Queued. It starts on the next narrator run.');
    }));
    on('[data-narrate-article]', () => voiceSheet(async (voice) => { const k = await narrate.narrateArticle(key, voice); toast(k ? 'Narration started.' : 'Queued for the narrator.'); }));
    on('[data-align]', async () => { const det = await catalog.detail(w); const k = await narrate.makeReadAlong(w, det.s || []); toast(k ? 'Read-along started.' : 'Queued for the narrator.'); });
    view.querySelectorAll('[data-retry]').forEach((n) => n.addEventListener('click', () => narrate.retry(store.find('narrations', n.dataset.retry))));
    view.querySelectorAll('[data-cancel-narr]').forEach((n) => n.addEventListener('click', () => {
      const job = store.find('narrations', n.dataset.cancelNarr);
      const what = job?.kind === 'lv' ? 'the read-along text' : 'the AI narration';
      confirmSheet(`Cancel ${what}?`, 'Cancel it', async () => { await store.remove('narrations', n.dataset.cancelNarr); toast('Cancelled.'); });
    }));
    on('[data-dismiss-prog]', () => dismissProgress(b.key));
    on('[data-del-article]', () => confirmSheet('Delete this article?', 'Delete', async () => { await store.remove('narrations', key); await store.remove('progress', key); location.hash = '#/library?t=narrations'; }));
    view.querySelector('.desc')?.addEventListener('click', (e) => e.currentTarget.classList.toggle('clamp'));
  };
  await draw();
  const redraw = debounce(draw, 120);
  const offs = [store.watch('narrations', redraw), store.watch('shelf', redraw), offline.onChange(redraw)];
  return () => { disposed = true; offs.forEach((f) => f()); };
}

export function voiceSheet(onPick) {
  const cur = store.settings().voice;
  sheet((s, close) => {
    s.innerHTML = `<p class="h2">Choose a narrator</p><p class="sub">The narrator reads every chapter with this voice and syncs the text as it goes.</p>` +
      narrate.VOICES.map((v) => `<button class="opt${v.id === cur ? ' on' : ''}" data-v="${v.id}"><span>${esc(v.name)}<span class="small">${esc(v.note)}</span></span>${v.id === cur ? icon('check') : ''}</button>`).join('');
    s.addEventListener('click', (e) => {
      const b = e.target.closest('[data-v]'); if (!b) return;
      store.saveSettings({ voice: b.dataset.v }); close(); onPick(b.dataset.v);
    });
  });
}

function confirmSheet(question, label, fn) {
  sheet((s, close) => {
    s.innerHTML = `<p class="h2">${esc(question)}</p><div class="row-actions" style="margin-top:18px"><button class="btn primary" data-yes>${esc(label)}</button><button class="btn ghost" data-no>Cancel</button></div>`;
    s.querySelector('[data-yes]').onclick = () => { close(); fn(); };
    s.querySelector('[data-no]').onclick = close;
  });
}

/* ---------- Library ---------- */

export async function library(view, params) {
  await catalog.load();
  let tab = params.get('t') || 'shelf';
  if (tab === 'downloads' && !store.isNative()) tab = 'shelf';
  const draw = async () => {
    let body;
    if (tab === 'shelf') {
      const list = store.get('shelf').sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0)).map(asWork);
      body = list.length ? html`<div class="grid">${list.map((w) => bookCard(w))}</div>`
        : html`<div class="empty"><p class="h2">Your library is empty</p><p>Tap the heart on any book to keep it here.</p><a class="btn" href="#/explore">Find a book</a></div>`;
    } else if (tab === 'downloads') {
      const list = offline.list();
      const used = await offline.usage();
      body = list.length ? html`<p class="small" style="margin:0 0 6px">${offline.fmtBytes(used)} used on this device</p>
        <div>${list.map((d) => html`<div class="item"><a href="#/book/${d.key}">${raw(coverHTML(d))}</a><a href="#/book/${d.key}"><p class="it">${d.title}</p><p class="small" style="margin:0">${d.author}${d.bytes ? `, ${offline.fmtBytes(d.bytes)}` : ''}</p></a><button class="icon-btn" data-rm="${d.key}" aria-label="Remove download">${raw(icon('trash'))}</button></div>`)}</div>`
        : html`<div class="empty"><p class="h2">Nothing downloaded yet</p><p>Download a book on Wi‑Fi and it plays anywhere, even with no signal.</p></div>`;
    } else {
      const list = store.get('narrations').filter((n) => n.kind !== 'lv').sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
      body = list.length ? html`<div>${list.map((n) => {
        const k = n.kind === 'ar' ? n.id : (catalog.get(n.id)?.key || n.id);
        const frac = n.chaptersTotal ? n.chaptersDone / n.chaptersTotal : 0;
        return html`<a class="item" href="#/book/${k}">${raw(coverHTML({ title: n.title, author: n.site || n.author, cover: n.cover }))}<div><p class="it">${n.title}</p><p class="small" style="margin:0">${narrate.statusText(n)}</p>${n.status === 'working' ? html`<div class="progress"><span style="transform:scaleX(${frac})"></span></div>` : ''}</div><span class="ico" style="color:var(--mist)">${raw(icon(n.kind === 'ar' ? 'globe' : 'sparkle'))}</span></a>`;
      })}</div>`
        : html`<div class="empty"><p class="h2">No narrations or articles yet</p><p>Add an article link, or pick a book without a recording and choose “Narrate with AI voice”.</p></div>`;
    }
    render(view, html`
      <div class="wrap">
        <header class="topbar"><h1 class="h1">Library</h1><button class="btn small" data-add>${raw(icon('plus'))}Article</button></header>
        <div class="seg" role="tablist">
          <button data-t="shelf" class="${tab === 'shelf' ? 'on' : ''}">Saved</button>
          ${store.isNative() ? html`<button data-t="downloads" class="${tab === 'downloads' ? 'on' : ''}">Downloads</button>` : ''}
          <button data-t="narrations" class="${tab === 'narrations' ? 'on' : ''}">Narrations</button>
        </div>
        ${body}
      </div>`);
    view.querySelector('.seg').addEventListener('click', (e) => {
      const b = e.target.closest('[data-t]'); if (!b) return;
      tab = b.dataset.t; history.replaceState(history.state, '', `#/library?t=${tab}`); draw();
    });
    view.querySelectorAll('[data-rm]').forEach((b) => b.addEventListener('click', async () => { await offline.remove(b.dataset.rm); toast('Download removed.'); }));
    view.querySelector('[data-add]').addEventListener('click', articleSheet);
  };
  await draw();
  const redraw = debounce(draw, 100);
  const offs = [store.watch('shelf', redraw), store.watch('narrations', redraw), offline.onChange(redraw)];
  return () => offs.forEach((f) => f());
}

export function articleSheet(prefill = {}) {
  sheet((s, close) => {
    s.innerHTML = `<p class="h2">Add an article</p><p class="sub">Paste a link. If the page can’t be read here, the narrator fetches it for you.</p>
      <label class="field"><span>Link</span><input class="input" name="url" type="url" inputmode="url" placeholder="https://" value="${esc(prefill.url || '')}"></label>
      <details style="margin-bottom:14px"><summary class="small" style="cursor:pointer;padding:6px 0">Or paste the text instead</summary>
        <label class="field" style="margin-top:10px"><span>Title</span><input class="input" name="title" value="${esc(prefill.title || '')}"></label>
        <label class="field"><span>Text</span><textarea class="textarea" name="text">${esc(prefill.text || '')}</textarea></label></details>
      <p class="err"></p>
      <button class="btn primary" style="width:100%" data-save>Add article</button>`;
    const btn = s.querySelector('[data-save]');
    btn.onclick = async () => {
      const url = s.querySelector('[name=url]').value.trim(), text = s.querySelector('[name=text]').value.trim(), title = s.querySelector('[name=title]').value.trim();
      if (!url && !text) { s.querySelector('.err').textContent = 'Add a link or paste some text.'; return; }
      btn.disabled = true; btn.textContent = 'Reading the page…';
      const { id, hasText } = await narrate.addArticle({ url, text, title });
      close();
      toast(hasText ? 'Article added. It’s ready to listen.' : 'Article queued. The narrator will fetch and read it.');
      location.hash = `#/book/${id}`;
    };
  });
}

/* ---------- Saved (bookmarks) ---------- */

export async function saved(view) {
  await catalog.load();
  const draw = () => {
    const marks = store.get('bookmarks').sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
    const groups = new Map();
    marks.forEach((m) => { if (!groups.has(m.key)) groups.set(m.key, []); groups.get(m.key).push(m); });
    render(view, html`
      <div class="wrap">
        <header class="topbar"><h1 class="h1">Saved moments</h1><span class="small">${marks.length || ''}</span></header>
        ${marks.length ? [...groups.values()].map((list) => html`
          <p class="group-title">${list[0].title}</p>
          ${list.map((m) => html`<div class="mark" role="button" tabindex="0" data-id="${m.id}">
            <p class="quote">${m.text}</p>
            <div class="where"><span class="small">${m.chapterTitle || `Chapter ${m.chapter + 1}`}, ${fmtTime(m.pos)}</span>
            <button class="icon-btn" data-del="${m.id}" aria-label="Delete bookmark">${raw(icon('trash'))}</button></div></div>`)}`)
        : html`<div class="empty"><p class="h2">Hold a line to save it</p><p>While listening, press and hold any sentence in the read-along view, or tap the bookmark button. Saved lines collect here.</p></div>`}
      </div>`);
  };
  const onClick = async (e) => {
    const del = e.target.closest('[data-del]');
    if (del) { e.stopPropagation(); await store.remove('bookmarks', del.dataset.del); toast('Bookmark deleted.'); return; }
    const card = e.target.closest('.mark'); if (!card) return;
    const m = store.find('bookmarks', card.dataset.id); if (!m) return;
    const b = await books.resolve(m.key);
    if (books.playable(b)) player.open(b, { chapter: m.chapter, pos: m.pos });
    else toast('This book isn’t playable right now.');
  };
  view.addEventListener('click', onClick);
  draw();
  const off = store.watch('bookmarks', draw);
  return () => { off(); view.removeEventListener('click', onClick); };
}

/* ---------- Settings ---------- */

export async function settings(view, user) {
  const s = store.settings();
  const used = await offline.usage();
  render(view, html`
    <div class="wrap" style="max-width:640px">
      <header class="topbar"><button class="icon-btn" data-back aria-label="Back">${raw(icon('back'))}</button><h1 class="h1" style="flex:1">Settings</h1></header>
      <section class="section" style="margin-top:8px">
        <p class="group-title" style="margin-top:0">Account</p>
        <div class="item" style="grid-template-columns:1fr auto"><div><p class="it">${user?.email || ''}</p><p class="small" style="margin:0">${store.isDemo() ? 'Preview mode on this device' : 'Synced with Firebase'}</p></div>${store.isDemo() ? '' : html`<button class="btn small" data-out>Sign out</button>`}</div>
      </section>
      <section class="section">
        <p class="group-title">Narration</p>
        <button class="opt" data-voice><span>AI narrator voice<span class="small">${narrate.VOICES.find((v) => v.id === s.voice)?.name || s.voice}</span></span>${raw(icon('voice'))}</button>
        <label class="switch"><span>Read article links on this device<span class="small" style="display:block">Sends the link to a reader service (r.jina.ai) so articles open instantly.</span></span><input type="checkbox" data-k="readerProxy" ${s.readerProxy ? 'checked' : ''}></label>
        <p class="small" style="margin:18px 0 10px">Start narrations instantly. Without this, new requests start on the next scheduled run (every three hours) or when your PC narrator is running.</p>
        <label class="field"><span>GitHub repository</span><input class="input" data-k="ghRepo" placeholder="XEDD-997/xenoreads" value="${s.ghRepo}"></label>
        <label class="field"><span>GitHub token (fine-grained: Actions and Contents, read and write)</span><input class="input" data-k="ghToken" type="password" placeholder="github_pat_…" value="${s.ghToken}" autocomplete="off"></label>
        <p class="small" style="margin:0">Stored only on this device.</p>
      </section>
      <section class="section">
        <p class="group-title">Appearance</p>
        <div class="seg" data-theme-seg style="margin-bottom:6px">
          <button data-th="auto" class="${s.theme === 'auto' ? 'on' : ''}">Auto</button>
          <button data-th="day" class="${s.theme === 'day' ? 'on' : ''}">Day</button>
          <button data-th="night" class="${s.theme === 'night' ? 'on' : ''}">Night</button>
        </div>
        <p class="small" style="margin:0 0 4px">Auto follows your phone: cream by day, navy at night.</p>
        <label class="switch"><span>Reduce effects<span class="small" style="display:block">Turns off the glass blur behind the tab bar on older phones.</span></span><input type="checkbox" data-k="lite" ${s.lite ? 'checked' : ''}></label>
      </section>
      ${store.isNative() ? html`<section class="section">
        <p class="group-title">Storage</p>
        <div class="item" style="grid-template-columns:1fr auto"><div><p class="it">${offline.fmtBytes(used)}</p><p class="small" style="margin:0">Downloads and app data on this device</p></div><a class="btn small" href="#/library?t=downloads">Manage</a></div>
      </section>` : ''}
      <p class="small" style="margin-top:36px;text-align:center">Xenoreads. Recordings from LibriVox, texts from Project Gutenberg, narration by Kokoro.</p>
    </div>`);
  view.querySelector('[data-back]').onclick = () => history.back();
  view.querySelector('[data-out]')?.addEventListener('click', () => store.signOut());
  view.querySelector('[data-theme-seg]').addEventListener('click', (e) => {
    const b = e.target.closest('[data-th]'); if (!b) return;
    store.saveSettings({ theme: b.dataset.th });
    view.querySelectorAll('[data-th]').forEach((x) => x.classList.toggle('on', x === b));
    window.dispatchEvent(new Event('xr-theme'));
  });
  view.querySelector('[data-voice]').onclick = () => voiceSheet(() => settings(view, user));
  view.querySelectorAll('[data-k]').forEach((n) => n.addEventListener('change', () => {
    const v = n.type === 'checkbox' ? n.checked : n.value.trim();
    store.saveSettings({ [n.dataset.k]: v });
    if (n.dataset.k === 'lite') document.body.classList.toggle('lite', v);
    toast('Saved.');
  }));
}
