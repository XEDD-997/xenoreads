// Data layer. Firebase when configured, otherwise a local demo store (same API),
// so the app runs before Firebase is set up and while offline.
//
// Collections (all private to the owner):
//   shelf/{key}       books saved to My Library
//   progress/{key}    where you stopped in each book
//   bookmarks/{id}    saved moments (sentence text + position)
//   narrations/{key}  AI-voice narrations, article reads and read-along jobs

import config from './config.js';

const COLS = ['shelf', 'progress', 'bookmarks', 'narrations'];
const listeners = new Map(COLS.map((c) => [c, new Set()]));
const cache = new Map(COLS.map((c) => [c, []]));
let backend = null;
let userCb = () => {};

export const isDemo = () => !config || !config.firebase || !config.firebase.apiKey;
export const hostingBase = () => {
  const native = !!window.Capacitor?.isNativePlatform?.();
  return native && config?.hostingUrl ? config.hostingUrl.replace(/\/?$/, '/') : '';
};

function emit(col, docs) {
  cache.set(col, docs);
  listeners.get(col).forEach((cb) => cb(docs));
}

export function watch(col, cb) {
  listeners.get(col).add(cb);
  cb(cache.get(col));
  return () => listeners.get(col).delete(cb);
}
export const get = (col) => cache.get(col);
export const find = (col, id) => cache.get(col).find((d) => d.id === id);

/* ---------------- Local (demo) backend ---------------- */
function localBackend() {
  const KEY = (c) => `xr.${c}`;
  const read = (c) => { try { return JSON.parse(localStorage.getItem(KEY(c)) || '{}'); } catch { return {}; } };
  const write = (c, obj) => { try { localStorage.setItem(KEY(c), JSON.stringify(obj)); } catch { /* storage full */ } };
  const publish = (c) => emit(c, Object.entries(read(c)).map(([id, d]) => ({ id, ...d })));
  return {
    async start() {
      COLS.forEach(publish);
      userCb({ email: 'demo@xenoreads', demo: true });
    },
    async set(c, id, data, merge = true) {
      const all = read(c); all[id] = merge ? { ...(all[id] || {}), ...data } : data; write(c, all); publish(c);
    },
    async add(c, data) { const id = Math.random().toString(36).slice(2, 12); await this.set(c, id, data, false); return id; },
    async remove(c, id) { const all = read(c); delete all[id]; write(c, all); publish(c); },
    async signIn() { userCb({ email: 'demo@xenoreads', demo: true }); },
    async signOut() { userCb(null); },
    now: () => Date.now(),
  };
}

/* ---------------- Firebase backend ---------------- */
async function firebaseBackend() {
  const { initializeApp } = await import('../vendor/firebase-app.js');
  const A = await import('../vendor/firebase-auth.js');
  const F = await import('../vendor/firebase-firestore.js');
  const app = initializeApp(config.firebase);
  const auth = A.getAuth(app);
  let db;
  try {
    db = F.initializeFirestore(app, { localCache: F.persistentLocalCache({ tabManager: F.persistentMultipleTabManager() }) });
  } catch {
    db = F.getFirestore(app);
  }
  let unsubs = [];
  const toMs = (v) => (v && typeof v.toMillis === 'function' ? v.toMillis() : v);
  const norm = (d) => {
    const o = { id: d.id, ...d.data() };
    for (const k of Object.keys(o)) if (o[k] && typeof o[k].toMillis === 'function') o[k] = toMs(o[k]);
    return o;
  };
  return {
    async start() {
      A.onAuthStateChanged(auth, (u) => {
        unsubs.forEach((f) => f()); unsubs = [];
        if (u) {
          COLS.forEach((c) => unsubs.push(F.onSnapshot(F.collection(db, c), (snap) => emit(c, snap.docs.map(norm)), () => emit(c, []))));
        } else COLS.forEach((c) => emit(c, []));
        userCb(u ? { email: u.email, uid: u.uid } : null);
      });
    },
    set: (c, id, data, merge = true) => F.setDoc(F.doc(db, c, id), data, { merge }),
    async add(c, data) { const r = await F.addDoc(F.collection(db, c), data); return r.id; },
    remove: (c, id) => F.deleteDoc(F.doc(db, c, id)),
    signIn: (email, pw) => A.signInWithEmailAndPassword(auth, email, pw),
    signOut: () => A.signOut(auth),
    now: () => Date.now(),
  };
}

export async function start(onUser) {
  userCb = onUser;
  backend = isDemo() ? localBackend() : await firebaseBackend();
  await backend.start();
}

export const set = (c, id, data, merge) => backend.set(c, id, { ...data, updatedAt: Date.now() }, merge);
export const add = (c, data) => backend.add(c, { ...data, createdAt: Date.now(), updatedAt: Date.now() });
export const remove = (c, id) => backend.remove(c, id);
export const signIn = (e, p) => backend.signIn(e, p);
export const signOut = () => backend.signOut();

/* Device-only settings (never synced). */
const SKEY = 'xr.settings';
const defaults = { theme: 'auto', voice: 'af_heart', speed: 1, lite: false, readerProxy: true, ghToken: '', ghRepo: '', view: 'read' };
export function settings() { try { return { ...defaults, ...JSON.parse(localStorage.getItem(SKEY) || '{}') }; } catch { return { ...defaults }; } }
export function saveSettings(patch) { const s = { ...settings(), ...patch }; localStorage.setItem(SKEY, JSON.stringify(s)); return s; }
