// Catalog of classics: LibriVox recordings + Project Gutenberg texts, merged into "works".
// Built weekly by tools/build_catalog.py into web/catalog/ and served from Firebase Hosting.

import { hostingBase } from './store.js';

export const CATEGORIES = [
  { name: 'Classics', hue: 32 }, { name: 'Mystery & crime', hue: 220 }, { name: 'Science fiction', hue: 190 },
  { name: 'Fantasy', hue: 280 }, { name: 'Adventure', hue: 140 }, { name: 'Romance', hue: 345 },
  { name: 'Horror & ghost stories', hue: 0 }, { name: 'Short stories', hue: 48 }, { name: 'Poetry', hue: 300 },
  { name: 'Philosophy', hue: 250 }, { name: 'History', hue: 25 }, { name: 'Biography & memoir', hue: 170 },
  { name: 'Myths & legends', hue: 265 }, { name: "Children's", hue: 95 }, { name: 'Humor', hue: 55 },
  { name: 'Plays', hue: 330 }, { name: 'Religion & spirituality', hue: 40 }, { name: 'Science & nature', hue: 120 },
  { name: 'Essays & letters', hue: 205 }, { name: 'War', hue: 10 },
];

let works = [];
let byKey = new Map();
let loading = null;
const details = new Map();

export const lvCover = (ia) => (ia ? `https://archive.org/services/img/${ia}` : '');
export const gbCover = (id) => (id ? `https://www.gutenberg.org/cache/epub/${id}/pg${id}.cover.medium.jpg` : '');

function makeWork(row) {
  const [rawTitle, author, mask, lvId, gbId, dur, ia, pop, n] = row;
  // LibriVox numbers repeat recordings, e.g. "(Version 8)"; the app shows one per title.
  const title = String(rawTitle).replace(/\s*\((version \d+|solo|abridged|dramatic reading)[^)]*\)/gi, '').trim();
  const cats = [];
  for (let i = 0; i < CATEGORIES.length; i++) if (mask & (1 << i)) cats.push(i);
  return {
    key: lvId ? `lv-${lvId}` : `gb-${gbId}`, title, author, cats, lvId, gbId, dur, ia, pop, n,
    cover: lvId ? lvCover(ia) : gbCover(gbId),
  };
}

const DEMO = [
  ['Pride and Prejudice', 'Jane Austen', 1 | 32, 0, 1342, 0, '', 9e5, 0],
  ['The Adventures of Sherlock Holmes', 'Arthur Conan Doyle', 1 | 2 | 128, 0, 1661, 0, '', 7e5, 0],
  ['Frankenstein', 'Mary Wollstonecraft Shelley', 1 | 4 | 64, 0, 84, 0, '', 8e5, 0],
  ['Crime and Punishment', 'Fyodor Dostoyevsky', 1 | 2, 0, 2554, 0, '', 5e5, 0],
  ['The Picture of Dorian Gray', 'Oscar Wilde', 1 | 64, 0, 174, 0, '', 5e5, 0],
  ['Moby Dick; Or, The Whale', 'Herman Melville', 1 | 16, 0, 2701, 0, '', 6e5, 0],
  ['The Time Machine', 'H. G. Wells', 1 | 4, 0, 35, 0, '', 3e5, 0],
  ['Meditations', 'Marcus Aurelius', 512, 0, 2680, 0, '', 3e5, 0],
  ['The Great Gatsby', 'F. Scott Fitzgerald', 1 | 32, 0, 64317, 0, '', 4e5, 0],
  ['Dracula', 'Bram Stoker', 1 | 64, 0, 345, 0, '', 5e5, 0],
  ['The Metamorphosis', 'Franz Kafka', 1 | 128, 0, 5200, 0, '', 4e5, 0],
  ['Alice’s Adventures in Wonderland', 'Lewis Carroll', 1 | 8 | 8192, 0, 11, 0, '', 6e5, 0],
];

export function load() {
  if (loading) return loading;
  loading = (async () => {
    let rows = DEMO;
    try {
      const res = await fetch(`${hostingBase()}catalog/index.json`, { cache: 'no-cache' });
      if (res.ok) { const j = await res.json(); if (j.w?.length) rows = j.w; }
    } catch { /* offline with nothing cached: demo shelf */ }
    works = rows.map(makeWork);
    byKey = new Map(works.map((w) => [w.key, w]));
    // Gutenberg ids also resolve to their LibriVox work when both exist.
    for (const w of works) if (w.lvId && w.gbId && !byKey.has(`gb-${w.gbId}`)) byKey.set(`gb-${w.gbId}`, w);
    return works;
  })();
  return loading;
}

export const all = () => works;
export const get = (key) => byKey.get(key);
export const count = () => works.length;

export function popular(n = 24, filter = () => true) {
  return works.filter(filter).sort((a, b) => b.pop - a.pop).slice(0, n);
}
export function inCategory(i, n = 60) {
  return popular(n, (w) => w.cats.includes(i));
}
export function categoryCounts() {
  const c = new Array(CATEGORIES.length).fill(0);
  for (const w of works) for (const i of w.cats) c[i]++;
  return c;
}

const fold = (s) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
export function search(q, { cat = -1, kind = 'all', limit = 120 } = {}) {
  const t = fold(q.trim());
  const words = t.split(/\s+/).filter(Boolean);
  const out = [];
  for (const w of works) {
    if (cat >= 0 && !w.cats.includes(cat)) continue;
    if (kind === 'human' && !w.lvId) continue;
    if (kind === 'text' && !w.gbId) continue;
    if (!words.length) { out.push([w, w.pop]); continue; }
    w._q ||= fold(`${w.title} ${w.author}`);
    if (!words.every((x) => w._q.includes(x))) continue;
    const title = w._q.slice(0, w.title.length);
    let score = w.pop / 1e6;
    if (title.startsWith(t)) score += 3; else if (title.includes(` ${words[0]}`)) score += 1.5;
    if (fold(w.author).includes(t)) score += 2;
    out.push([w, score]);
  }
  return out.sort((a, b) => b[1] - a[1]).slice(0, limit).map((x) => x[0]);
}

/** Description and LibriVox chapter list for one work. */
export async function detail(w) {
  if (details.has(w.key)) return details.get(w.key);
  const p = (async () => {
    if (!w.lvId && !w.gbId) return { d: '', s: [] };
    const [kind, id] = w.lvId ? ['lv', w.lvId] : ['gb', w.gbId];
    try {
      const res = await fetch(`${hostingBase()}catalog/d/${kind}-${id % 128}.json`);
      if (!res.ok) throw new Error(res.status);
      const j = await res.json();
      return j[id] || { d: '', s: [] };
    } catch { return { d: '', s: [] }; }
  })();
  details.set(w.key, p);
  return p;
}
