import * as store from './store.js';
import * as catalog from './catalog.js';
import * as views from './views.js';
import { $, $$, hydrateIcons, toast } from './ui.js';
import './player.js';

const view = $('#view');
const scroller = $('#app');
let user = null;
let dispose = null;
const scrolls = new Map();
let currentPath = '';

if (store.settings().lite) document.body.classList.add('lite');

// Day (cream) and Night (navy). "auto" follows the phone's light/dark setting.
const darkQuery = matchMedia('(prefers-color-scheme: dark)');
export function applyTheme() {
  const pref = store.settings().theme;
  const day = pref === 'day' || (pref === 'auto' && !darkQuery.matches);
  document.documentElement.dataset.theme = day ? 'light' : 'dark';
  const bg = day ? '#F5EEDB' : '#11192C';
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', bg);
  const cap = window.Capacitor;
  const bar = cap?.isNativePlatform?.() ? (cap.Plugins?.StatusBar || cap.registerPlugin?.('StatusBar')) : null;
  try { bar?.setBackgroundColor({ color: bg }); bar?.setStyle({ style: day ? 'LIGHT' : 'DARK' }); } catch { /* older app build */ }
}
applyTheme();
darkQuery.addEventListener?.('change', applyTheme);
window.addEventListener('xr-theme', applyTheme);

// Android app: the back button closes the player or goes back, and only exits from the top.
const capApp = window.Capacitor?.isNativePlatform?.() ? (window.Capacitor.Plugins?.App || window.Capacitor.registerPlugin?.('App')) : null;
capApp?.addListener('backButton', ({ canGoBack }) => { if (canGoBack) history.back(); else capApp.exitApp(); });
hydrateIcons();

function parse() {
  const h = location.hash.replace(/^#\/?/, '') || 'home';
  const [path, qs] = h.split('?');
  const [name, ...rest] = path.split('/');
  return { name, arg: decodeURIComponent(rest.join('/')), params: new URLSearchParams(qs || ''), path };
}

async function route() {
  if (!user) return;
  const r = parse();
  scrolls.set(currentPath, scroller.scrollTop);
  if (typeof dispose === 'function') dispose();
  dispose = null;
  document.body.classList.remove('signed-out');
  $$('#tabs a').forEach((a) => a.classList.toggle('on', a.dataset.tab === r.name));
  const run = async () => {
    switch (r.name) {
      case 'explore': dispose = await views.explore(view, r.params); break;
      case 'book': dispose = await views.book(view, r.arg); break;
      case 'library': dispose = await views.library(view, r.params); break;
      case 'saved': dispose = await views.saved(view); break;
      case 'settings': dispose = await views.settings(view, user); break;
      default: dispose = await views.home(view, user);
    }
    const back = scrolls.get(r.path);
    scroller.scrollTop = r.name === 'book' ? 0 : back || 0;
  };
  currentPath = r.path;
  if (document.startViewTransition && !matchMedia('(prefers-reduced-motion: reduce)').matches) {
    // Snapshot after at most 300 ms so a slow network never stalls navigation.
    let done;
    const finished = new Promise((r) => { done = r; });
    const t = document.startViewTransition(() => Promise.race([run().finally(done), new Promise((r) => setTimeout(r, 300))]));
    t.ready.catch(() => {}); t.updateCallbackDone.catch(() => {}); t.finished.catch(() => {});
    await finished;
  } else await run();
}

window.addEventListener('hashchange', route);

// Tapping the active tab scrolls back to the top.
$('#tabs').addEventListener('click', (e) => {
  const a = e.target.closest('a');
  if (a && location.hash.startsWith(a.getAttribute('href').split('?')[0]) && parse().name === a.dataset.tab) {
    e.preventDefault(); scroller.scrollTo({ top: 0, behavior: 'smooth' });
  }
});

function handleShare() {
  const p = new URLSearchParams(location.search);
  if (!p.has('url') && !p.has('text')) return;
  const textUrl = (p.get('text') || '').match(/https?:\/\/\S+/)?.[0];
  const url = p.get('url') || textUrl || '';
  history.replaceState(null, '', `${location.pathname.replace(/share\/?$/, '')}#/library?t=narrations`);
  setTimeout(() => views.articleSheet({ url, title: p.get('title') || '' }), 400);
}

store.start(async (u) => {
  user = u;
  if (!u) { if (typeof dispose === 'function') dispose(); views.signIn(view); return; }
  catalog.load();
  await route();
  handleShare();
}).catch((e) => {
  view.innerHTML = `<div class="wrap"><div class="empty"><p class="h2">Xenoreads couldn’t start</p><p>${String(e.message || e)}</p></div></div>`;
});

// Offline support for the website (the Android app ships its files inside the APK).
if ('serviceWorker' in navigator && !window.Capacitor?.isNativePlatform?.() && location.protocol === 'https:') {
  const hadController = !!navigator.serviceWorker.controller;
  navigator.serviceWorker.register('sw.js').catch(() => {});
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (hadController) toast('Xenoreads was updated.', { label: 'Reload', run: () => location.reload() });
  });
}
