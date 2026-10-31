// Queue AI narrations / read-along jobs and articles. The narrator (GitHub Actions or
// your PC) picks up anything in narrations/ with status "queued".

import * as store from './store.js';

export const VOICES = [
  { id: 'af_heart', name: 'Heart', note: 'Warm American voice. The most natural one.' },
  { id: 'bm_george', name: 'George', note: 'British storyteller, lower and steady.' },
  { id: 'bf_emma', name: 'Emma', note: 'Clear British voice.' },
  { id: 'am_michael', name: 'Michael', note: 'Calm American voice.' },
  { id: 'af_bella', name: 'Bella', note: 'Bright American voice.' },
  { id: 'bm_fable', name: 'Fable', note: 'Lively British narrator.' },
];

export function statusText(n) {
  if (!n) return '';
  const done = n.chaptersDone || 0, total = n.chaptersTotal || 0;
  switch (n.status) {
    case 'queued': return n.kind === 'lv' ? 'Waiting to make the read-along text' : 'Waiting for the narrator';
    case 'working': return total ? `${n.kind === 'lv' ? 'Syncing text' : 'Narrating'}: ${done} of ${total} chapters` : 'Preparing the text';
    case 'ready': return n.kind === 'lv' ? 'Read-along ready' : 'Narration ready';
    case 'error': return `Stopped: ${n.error || 'something went wrong'}`;
    case 'text': return 'Ready for your device voice';
    default: return '';
  }
}

async function kick() {
  const { ghToken, ghRepo } = store.settings();
  if (!ghToken || !ghRepo) return false;
  try {
    const r = await fetch(`https://api.github.com/repos/${ghRepo}/actions/workflows/narrator.yml/dispatches`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${ghToken}`, Accept: 'application/vnd.github+json' },
      body: JSON.stringify({ ref: 'main' }),
    });
    return r.ok;
  } catch { return false; }
}

export async function narrateGutenberg(work, voice) {
  await store.set('narrations', `gb-${work.gbId}`, {
    kind: 'gb', gbId: work.gbId, title: work.title, author: work.author || '', cover: work.cover || '',
    voice, status: 'queued', chaptersDone: 0, chaptersTotal: 0, chapters: [], error: '', createdAt: Date.now(),
  }, false);
  return kick();
}

export async function makeReadAlong(work, sections) {
  await store.set('narrations', `lv-${work.lvId}`, {
    kind: 'lv', lvId: work.lvId, title: work.title, author: work.author || '', cover: work.cover || '',
    sections: sections.map(([title, url, dur]) => ({ title, url, dur })),
    status: 'queued', chaptersDone: 0, chaptersTotal: sections.length, chapters: [], error: '', createdAt: Date.now(),
  }, false);
  return kick();
}

export async function narrateArticle(key, voice) {
  await store.set('narrations', key, { status: 'queued', voice, chapters: [], error: '' });
  return kick();
}

export async function retry(n) {
  await store.set('narrations', n.id, { status: 'queued', error: '' });
  return kick();
}

/** Fetch readable article text in the browser (via a reader service), if allowed. */
export async function fetchArticle(url) {
  if (!store.settings().readerProxy) return null;
  try {
    const r = await fetch(`https://r.jina.ai/${url}`, { headers: { Accept: 'text/plain', 'X-Return-Format': 'text' } });
    if (!r.ok) return null;
    const t = await r.text();
    const title = (t.match(/^Title:\s*(.+)$/m) || [])[1]?.trim() || '';
    let body = t.split(/^Markdown Content:\s*$/m)[1] ?? t.replace(/^(Title|URL Source|Published Time):.*$/gm, '');
    body = body
      .replace(/!\[[^\]]*]\([^)]*\)/g, '')
      .replace(/\[([^\]]+)]\([^)]*\)/g, '$1')
      .replace(/^#{1,6}\s*/gm, '')
      .replace(/^[*-]\s+/gm, '')
      .replace(/[*_`>]/g, '')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
    if (body.split(/\s+/).length < 60) return null;
    return { title, text: body };
  } catch { return null; }
}

export async function addArticle({ url, text, title }) {
  let site = '';
  try { site = url ? new URL(url).hostname.replace(/^www\./, '') : ''; } catch { /* not a URL */ }
  let got = text ? { title: title || '', text } : await fetchArticle(url);
  const id = `ar-${Date.now().toString(36)}`;
  await store.set('narrations', id, {
    kind: 'ar', url: url || '', site, title: got?.title || title || site || 'Untitled article',
    text: got?.text || '', status: got?.text ? 'text' : 'queued', voice: store.settings().voice,
    chapters: [], error: '', createdAt: Date.now(),
  }, false);
  if (!got?.text) kick();
  return { id, hasText: !!got?.text };
}
