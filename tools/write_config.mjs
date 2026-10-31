// Used by GitHub Actions: turns the FIREBASE_CONFIG secret into web/js/config.js,
// fills your email into the security rules, and stamps a build id on the service worker.
// FIREBASE_CONFIG may be JSON or the `const firebaseConfig = {...}` snippet from the console.
import { readFileSync, writeFileSync, appendFileSync } from 'node:fs';

const raw = process.env.FIREBASE_CONFIG || '';
const start = raw.indexOf('{'), end = raw.lastIndexOf('}');
if (start < 0 || end < 0) { console.error('FIREBASE_CONFIG secret is missing or has no { ... } object.'); process.exit(1); }
let cfg;
try { cfg = new Function(`return (${raw.slice(start, end + 1)});`)(); }
catch (e) { console.error('FIREBASE_CONFIG could not be read:', e.message); process.exit(1); }
for (const k of ['apiKey', 'authDomain', 'projectId', 'appId']) {
  if (!cfg[k]) { console.error(`FIREBASE_CONFIG is missing "${k}".`); process.exit(1); }
}
const firebase = Object.fromEntries(['apiKey', 'authDomain', 'projectId', 'storageBucket', 'messagingSenderId', 'appId'].filter((k) => cfg[k]).map((k) => [k, cfg[k]]));
const hostingUrl = `https://${cfg.projectId}.web.app/`;
writeFileSync('web/js/config.js', `// Generated at build time.\nexport default ${JSON.stringify({ firebase, hostingUrl }, null, 2)};\n`);

const owner = (process.env.OWNER_EMAIL || '').trim().toLowerCase();
if (owner) {
  for (const f of ['firestore.rules', 'storage.rules']) writeFileSync(f, readFileSync(f, 'utf8').replaceAll('__OWNER_EMAIL__', owner));
} else if (process.argv.includes('--rules')) {
  console.error('OWNER_EMAIL secret is missing; refusing to deploy rules that lock everyone out.'); process.exit(1);
}

const build = `${Date.now().toString(36)}-${(process.env.GITHUB_SHA || 'local').slice(0, 7)}`;
writeFileSync('web/sw.js', readFileSync('web/sw.js', 'utf8').replace('__BUILD__', build));

if (process.env.GITHUB_ENV) {
  appendFileSync(process.env.GITHUB_ENV, `PROJECT_ID=${cfg.projectId}\nSTORAGE_BUCKET=${cfg.storageBucket || ''}\n`);
}
console.log(`Config written for project ${cfg.projectId} (build ${build}).`);
