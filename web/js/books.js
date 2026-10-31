// Turns a book key into something the player can play.
//   lv-<id>  LibriVox human narration (+ read-along text if generated)
//   gb-<id>  Gutenberg text narrated by the AI voice (narrations/gb-<id>)
//   ar-<id>  Saved article: AI narration if ready, else the device voice
//   demo-1   Built-in sample so the app is playable before setup

import * as catalog from './catalog.js';
import * as store from './store.js';

export const DEMO_KEY = 'demo-1';
const DEMO_TEXT = `Chapter 1

It is a truth universally acknowledged, that a single man in possession of a good fortune, must be in want of a wife.

However little known the feelings or views of such a man may be on his first entering a neighbourhood, this truth is so well fixed in the minds of the surrounding families, that he is considered as the rightful property of some one or other of their daughters.

"My dear Mr. Bennet," said his lady to him one day, "have you heard that Netherfield Park is let at last?"

Mr. Bennet replied that he had not.

"But it is," returned she; "for Mrs. Long has just been here, and she told me all about it."

Mr. Bennet made no answer.

"Do not you want to know who has taken it?" cried his wife impatiently.

"You want to tell me, and I have no objection to hearing it."

This was invitation enough.

"Why, my dear, you must know, Mrs. Long says that Netherfield is taken by a young man of large fortune from the north of England; that he came down on Monday in a chaise and four to see the place, and was so much delighted with it that he agreed with Mr. Morris immediately; that he is to take possession before Michaelmas, and some of his servants are to be in the house by the end of next week."

"What is his name?"

"Bingley."

"Is he married or single?"

"Oh! single, my dear, to be sure! A single man of large fortune; four or five thousand a year. What a fine thing for our girls!"

"How so? how can it affect them?"

"My dear Mr. Bennet," replied his wife, "how can you be so tiresome! You must know that I am thinking of his marrying one of them."

"Is that his design in settling here?"

"Design! nonsense, how can you talk so! But it is very likely that he may fall in love with one of them, and therefore you must visit him as soon as he comes."`;

const ABBR = /\b(Mr|Mrs|Ms|Dr|St|Jr|Sr|Mt|Prof|Capt|Col|Gen|Lt|Rev|Hon|vs|etc|No|Vol|Ch|Fig|i\.e|e\.g)\.$/i;

/** Split prose into sentences, marking the first sentence of each paragraph. */
export function toSentences(text) {
  const out = [];
  const smart = (p) => p.replace(/(^|[\s(\[\u2014-])"/g, '$1\u201C').replace(/"/g, '\u201D').replace(/(\w)'/g, '$1\u2019').replace(/(^|[\s(\[\u2014-])'/g, '$1\u2018').replace(/'/g, '\u2019');
  const paras = String(text || '').replace(/\r/g, '').split(/\n\s*\n+/).map((p) => smart(p.replace(/\s+/g, ' ').trim())).filter(Boolean);
  for (const p of paras) {
    const parts = p.match(/[^.!?…]+(?:[.!?…]+["'”’)\]]*|$)\s*/g) || [p];
    let buf = '';
    let first = true;
    for (let k = 0; k < parts.length; k++) {
      buf += parts[k];
      const trimmed = buf.trim();
      const next = (parts[k + 1] || '').trimStart();
      if (ABBR.test(trimmed) || /(?:^|[\s.])[a-zA-Z]\.$/.test(trimmed) || /^[a-z]/.test(next)) continue;
      if (trimmed) { out.push({ t: trimmed, p: first }); first = false; }
      buf = '';
    }
    if (buf.trim()) out.push({ t: buf.trim(), p: first });
  }
  return out;
}

function speechChapters(text, title) {
  const s = toSentences(text);
  if (s.length && /^chapter\b/i.test(s[0].t) && s[0].t.length < 40) {
    s[0].title = true;
  } else if (title) s.unshift({ t: title, p: true, title: true });
  return [{ title: title || 'Article', sentences: s }];
}

export async function resolve(key) {
  await catalog.load();
  if (key === DEMO_KEY) {
    return {
      key, title: 'Pride and Prejudice', author: 'Jane Austen', cover: catalog.gbCover(1342), kind: 'speech',
      chapters: speechChapters(DEMO_TEXT), note: 'Sample chapter read by your device voice.',
    };
  }
  const narr = store.find('narrations', key);
  if (key.startsWith('ar-')) {
    if (!narr) return null;
    const base = { key, title: narr.title || 'Article', author: narr.site || narr.author || '', cover: narr.cover || '', narration: narr };
    if (narr.chapters?.length) return { ...base, kind: 'audio', chapters: narr.chapters };
    if (narr.text) return { ...base, kind: 'speech', chapters: speechChapters(narr.text, narr.title) };
    return { ...base, kind: 'pending', chapters: [] };
  }
  const work = catalog.get(key) || (narr && { key, title: narr.title, author: narr.author, cover: narr.cover, gbId: +key.slice(3) });
  if (!work) return null;
  const base = { key: work.key || key, title: work.title, author: work.author, cover: work.cover, work };
  if (key.startsWith('lv-')) {
    const det = await catalog.detail(work);
    const align = store.find('narrations', `lv-${work.lvId}`);
    const chapters = (det.s || []).map(([title, url, dur], i) => ({ title, url, dur, sync: align?.chapters?.[i]?.sync || '' }));
    return { ...base, kind: 'audio', source: 'lv', chapters, desc: det.d, align, gbNarr: work.gbId ? store.find('narrations', `gb-${work.gbId}`) : null };
  }
  const det = await catalog.detail(work);
  const gn = store.find('narrations', `gb-${work.gbId}`);
  return {
    ...base, key: `gb-${work.gbId}`, kind: gn?.chapters?.length ? 'audio' : 'pending', source: 'tts',
    chapters: gn?.chapters || [], desc: det.d, narration: gn,
  };
}

/** Same book but playing the AI narration of its Gutenberg text instead of LibriVox. */
export function asNarration(book) {
  const n = book.gbNarr;
  if (!n?.chapters?.length) return null;
  return { ...book, key: `gb-${book.work.gbId}`, kind: 'audio', source: 'tts', chapters: n.chapters, narration: n };
}

export function playable(book) {
  return book && (book.kind === 'speech' || (book.kind === 'audio' && book.chapters.length > 0));
}
