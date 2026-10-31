"""Xenoreads narrator.

Picks up jobs from Firestore `narrations/` and writes audio + read-along text to
Firebase Storage. Runs the same way on GitHub Actions and on your PC; a lease on
each job stops two machines working on the same book. Progress is saved after
every chapter, so a run that stops (time limit, PC shutdown) resumes later.

  python narrator.py check                 -> prints whether any job is waiting
  python narrator.py work [--loop] [--max-minutes 320]
  python narrator.py add gb 1342 [--voice bm_george]
  python narrator.py cors                  -> allow the app to download files (run once)

Job kinds:
  gb  Gutenberg book  -> Kokoro narration (m4a) + sentence sync per chapter
  ar  Article (url or text) -> Kokoro narration + sync
  lv  LibriVox recording -> faster-whisper transcript as read-along sync
"""
import argparse
import json
import os
import re
import socket
import sys
import tempfile
import threading
import time
import uuid
from pathlib import Path
from urllib.parse import quote

import requests

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import textproc  # noqa: E402

LEASE_SEC = 15 * 60
SR = 24000
GAP_SENTENCE, GAP_PARA, GAP_TITLE = 0.22, 0.6, 0.9
UA = {"User-Agent": "Xenoreads-narrator/1.0 (personal audiobook app)"}


def log(*a):
    print(time.strftime("%H:%M:%S"), *a, flush=True)


# ---------------------------------------------------------------- Firebase
def load_credentials():
    raw = os.environ.get("FIREBASE_SERVICE_ACCOUNT", "").strip()
    if raw:
        return json.loads(raw)
    for p in [HERE / "service-account.json", HERE.parent / "service-account.json"]:
        if p.exists():
            return json.loads(p.read_text(encoding="utf-8"))
    gac = os.environ.get("GOOGLE_APPLICATION_CREDENTIALS")
    if gac and Path(gac).exists():
        return json.loads(Path(gac).read_text(encoding="utf-8"))
    sys.exit("No service account found. Put service-account.json next to narrator.py "
             "or set FIREBASE_SERVICE_ACCOUNT.")


def bucket_name(project):
    if os.environ.get("FIREBASE_STORAGE_BUCKET"):
        return os.environ["FIREBASE_STORAGE_BUCKET"]
    cfg = os.environ.get("FIREBASE_CONFIG", "")
    m = re.search(r"storageBucket['\"]?\s*:\s*['\"]([^'\"]+)", cfg)
    if m:
        return m.group(1)
    f = HERE / "bucket.txt"
    if f.exists():
        return f.read_text().strip()
    return None


class Firebase:
    def __init__(self):
        import firebase_admin
        from firebase_admin import credentials, firestore, storage

        cred_info = load_credentials()
        self.project = cred_info["project_id"]
        name = bucket_name(self.project)
        app = firebase_admin.initialize_app(credentials.Certificate(cred_info), {"storageBucket": name} if name else {})
        self.fs = firestore
        self.db = firestore.client(app)
        self._storage = storage
        self._app = app
        self._bucket = None
        self._bucket_name = name

    @property
    def bucket(self):
        if self._bucket is None:
            names = [self._bucket_name] if self._bucket_name else [f"{self.project}.firebasestorage.app", f"{self.project}.appspot.com"]
            for n in names:
                b = self._storage.bucket(n, app=self._app)
                try:
                    if b.exists():
                        self._bucket = b
                        break
                except Exception as e:  # noqa: BLE001
                    log(f"Bucket {n}: {e}")
            if self._bucket is None:
                sys.exit("Couldn't find your Firebase Storage bucket. Set FIREBASE_STORAGE_BUCKET.")
        return self._bucket

    def jobs(self):
        col = self.db.collection("narrations")
        docs = list(col.where("status", "in", ["queued", "working"]).stream())
        now = time.time()
        ready = [d for d in docs if (d.to_dict() or {}).get("leaseUntil", 0) < now]
        return sorted(ready, key=lambda d: (d.to_dict() or {}).get("createdAt", 0))

    def claim(self, ref, worker):
        fs = self.fs

        @fs.transactional
        def tx_claim(tx):
            snap = ref.get(transaction=tx)
            d = snap.to_dict() or {}
            if d.get("status") not in ("queued", "working"):
                return False
            if d.get("leaseUntil", 0) > time.time() and d.get("worker") != worker:
                return False
            tx.update(ref, {"status": "working", "worker": worker, "leaseUntil": time.time() + LEASE_SEC, "error": ""})
            return True

        return tx_claim(self.db.transaction())

    def upload(self, local, path, content_type):
        blob = self.bucket.blob(path)
        token = str(uuid.uuid4())
        blob.metadata = {"firebaseStorageDownloadTokens": token}
        blob.cache_control = "public, max-age=31536000, immutable"
        blob.upload_from_filename(str(local), content_type=content_type)
        return f"https://firebasestorage.googleapis.com/v0/b/{self.bucket.name}/o/{quote(path, safe='')}?alt=media&token={token}"

    def upload_json(self, obj, path):
        with tempfile.NamedTemporaryFile("w", suffix=".json", delete=False, encoding="utf-8") as f:
            json.dump(obj, f, ensure_ascii=False, separators=(",", ":"))
        try:
            return self.upload(f.name, path, "application/json")
        finally:
            os.unlink(f.name)

    def read_json(self, path):
        blob = self.bucket.blob(path)
        if not blob.exists():
            return None
        return json.loads(blob.download_as_text(encoding="utf-8"))

    def set_cors(self):
        b = self.bucket
        b.cors = [{"origin": ["*"], "method": ["GET", "HEAD"], "responseHeader": ["Content-Type", "Content-Length", "Content-Range", "Accept-Ranges"], "maxAgeSeconds": 3600}]
        b.patch()


# ---------------------------------------------------------------- Lease keeper
class Lease:
    def __init__(self, ref, worker):
        self.ref, self.worker, self._stop = ref, worker, threading.Event()
        self.t = threading.Thread(target=self._run, daemon=True)

    def _run(self):
        while not self._stop.wait(240):
            try:
                self.ref.update({"leaseUntil": time.time() + LEASE_SEC, "worker": self.worker})
            except Exception as e:  # noqa: BLE001
                log("lease renew failed:", e)

    def __enter__(self):
        self.t.start()
        return self

    def __exit__(self, *a):
        self._stop.set()


# ---------------------------------------------------------------- Audio
_pipes = {}


def pipeline(voice):
    from kokoro import KPipeline

    lang = "b" if voice.startswith("b") else "a"
    if lang not in _pipes:
        log(f"Loading Kokoro ({'British' if lang == 'b' else 'American'} English)...")
        _pipes[lang] = KPipeline(lang_code=lang, repo_id="hexgrad/Kokoro-82M")
    return _pipes[lang]


def synth(text, voice):
    import numpy as np

    chunks = []
    for r in pipeline(voice)(text, voice=voice, speed=1.0, split_pattern=None):
        a = r.audio if hasattr(r, "audio") else r[2]
        if a is None:
            continue
        a = a.detach().cpu().numpy() if hasattr(a, "detach") else np.asarray(a)
        chunks.append(a.astype("float32").reshape(-1))
    return np.concatenate(chunks) if chunks else np.zeros(int(SR * 0.3), dtype="float32")


def ffmpeg():
    try:
        import imageio_ffmpeg

        return imageio_ffmpeg.get_ffmpeg_exe()
    except Exception:  # noqa: BLE001
        return "ffmpeg"


def encode_m4a(samples, out_path):
    import subprocess

    import soundfile as sf

    wav = str(out_path) + ".wav"
    sf.write(wav, samples, SR, subtype="PCM_16")
    cmd = [ffmpeg(), "-y", "-loglevel", "error", "-i", wav, "-ac", "1", "-c:a", "aac", "-b:a", "64k", "-movflags", "+faststart", str(out_path)]
    subprocess.run(cmd, check=True)
    os.unlink(wav)


def narrate_chapter(ch, voice, out_path):
    """Synthesize sentence by sentence; record exact start/end times for read-along."""
    import numpy as np

    parts, rows, t = [], [], 0.0

    def add(audio, text, flags, gap):
        nonlocal t
        dur = len(audio) / SR
        rows.append([round(t, 2), round(t + dur, 2), text, flags])
        parts.append(audio)
        parts.append(np.zeros(int(SR * gap), dtype="float32"))
        t += dur + gap

    if ch.get("spoken"):
        add(synth(textproc.for_speech(ch["spoken"]), voice), ch["title"], 3, GAP_TITLE)
    for p in ch["paragraphs"]:
        sents = textproc.sentences(p)
        for i, s in enumerate(sents):
            spoken = textproc.for_speech(s)
            if not re.search(r"\w", spoken):
                continue
            last = i == len(sents) - 1
            add(synth(spoken, voice), s, 1 if i == 0 else 0, GAP_PARA if last else GAP_SENTENCE)
    audio = np.concatenate(parts) if parts else np.zeros(SR, dtype="float32")
    encode_m4a(audio, out_path)
    return {"v": 1, "s": rows}, round(len(audio) / SR, 1)


# ---------------------------------------------------------------- Sources
def fetch_gutenberg(gid):
    urls = [
        f"https://www.gutenberg.org/cache/epub/{gid}/pg{gid}.txt",
        f"https://www.gutenberg.org/ebooks/{gid}.txt.utf-8",
        f"https://www.gutenberg.org/files/{gid}/{gid}-0.txt",
    ]
    for u in urls:
        try:
            r = requests.get(u, headers=UA, timeout=60)
            if r.ok and len(r.content) > 2000:
                r.encoding = "utf-8"
                return r.text
        except requests.RequestException as e:
            log(f"  {u}: {e}")
    raise RuntimeError("Couldn't download the book text from Project Gutenberg")


def fetch_article(url):
    import trafilatura

    html = trafilatura.fetch_url(url)
    if not html:
        r = requests.get(url, headers={**UA, "Accept": "text/html"}, timeout=45)
        r.raise_for_status()
        html = r.text
    doc = trafilatura.bare_extraction(html, url=url, include_comments=False, include_tables=False, favor_precision=True)
    if not doc:
        raise RuntimeError("Couldn't find readable text on that page")
    d = doc if isinstance(doc, dict) else doc.as_dict()
    text = d.get("text") or ""
    if len(text.split()) < 60:
        raise RuntimeError("That page has too little text to read")
    return d.get("title") or "", text, d.get("author") or ""


# ---------------------------------------------------------------- Jobs
def plan_for(fb, key, d):
    path = f"narrations/{key}/plan.json"
    plan = fb.read_json(path)
    if plan:
        return plan
    if d["kind"] == "gb":
        text = fetch_gutenberg(d["gbId"])
        chapters = textproc.chapters_from_book(text)
    else:
        title, text = d.get("title") or "", d.get("text") or ""
        if not text and d.get("url"):
            t2, text, author = fetch_article(d["url"])
            title = t2 or title
            fb.db.collection("narrations").document(key).update({"title": title or d.get("title", ""), "text": text, "author": author})
        chapters = textproc.chapters_from_article(title, text)
    plan = {"chapters": chapters}
    fb.upload_json(plan, path)
    return plan


def run_tts_job(fb, ref, d, deadline):
    key = ref.id
    voice = d.get("voice") or "af_heart"
    plan = plan_for(fb, key, d)
    chapters = plan["chapters"]
    done = list(d.get("chapters") or [])
    ref.update({"chaptersTotal": len(chapters), "chaptersDone": len(done)})
    log(f"{d.get('title')}: {len(chapters)} chapters, {len(done)} done, voice {voice}")
    with tempfile.TemporaryDirectory() as tmp:
        for i in range(len(done), len(chapters)):
            if time.time() > deadline:
                log("Time budget reached; will resume next run.")
                return False
            ch = chapters[i]
            started = time.time()
            out = Path(tmp) / f"{i:03d}.m4a"
            sync, dur = narrate_chapter(ch, voice, out)
            base = f"narrations/{key}/{voice}/{i:03d}"
            url = fb.upload(out, f"{base}.m4a", "audio/mp4")
            sync_url = fb.upload_json(sync, f"{base}.json")
            done.append({"title": ch["title"], "url": url, "sync": sync_url, "dur": dur})
            ref.update({"chapters": done, "chaptersDone": len(done)})
            log(f"  chapter {i + 1}/{len(chapters)} ({dur / 60:.1f} min audio) in {(time.time() - started) / 60:.1f} min")
    ref.update({"status": "ready", "leaseUntil": 0})
    return True


_whisper = None


def run_align_job(fb, ref, d, deadline):
    """Read-along for a LibriVox recording: transcribe each section with word timings."""
    global _whisper
    from faster_whisper import WhisperModel

    if _whisper is None:
        name = os.environ.get("WHISPER_MODEL", "base.en")
        log(f"Loading Whisper {name}...")
        _whisper = WhisperModel(name, device="cpu", compute_type="int8")
    sections = d.get("sections") or []
    done = list(d.get("chapters") or [])
    ref.update({"chaptersTotal": len(sections), "chaptersDone": len(done)})
    with tempfile.TemporaryDirectory() as tmp:
        for i in range(len(done), len(sections)):
            if time.time() > deadline:
                return False
            s = sections[i]
            mp3 = Path(tmp) / f"{i}.mp3"
            with requests.get(s["url"], headers=UA, stream=True, timeout=120) as r:
                r.raise_for_status()
                with open(mp3, "wb") as f:
                    for c in r.iter_content(1 << 16):
                        f.write(c)
            segs, _ = _whisper.transcribe(str(mp3), language="en", word_timestamps=True, vad_filter=False, beam_size=1)
            rows, cur, last_end = [], [], 0.0
            for seg in segs:
                for w in seg.words or []:
                    para = bool(cur == [] and (w.start - last_end) > 1.4 and rows)
                    cur.append(w)
                    txt = w.word.strip()
                    if re.search(r"[.!?][\"'”]?$", txt) and not textproc.ABBR.search(txt) or len(cur) > 42:
                        text = "".join(x.word for x in cur).strip()
                        rows.append([round(cur[0].start, 2), round(cur[-1].end, 2), text, 1 if (para or not rows) else 0])
                        last_end, cur = cur[-1].end, []
            if cur:
                rows.append([round(cur[0].start, 2), round(cur[-1].end, 2), "".join(x.word for x in cur).strip(), 0])
            sync_url = fb.upload_json({"v": 1, "s": rows}, f"narrations/{ref.id}/sync/{i:03d}.json")
            done.append({"title": s.get("title", ""), "sync": sync_url})
            ref.update({"chapters": done, "chaptersDone": len(done)})
            log(f"  section {i + 1}/{len(sections)} synced ({len(rows)} sentences)")
    ref.update({"status": "ready", "leaseUntil": 0})
    return True


def work(args):
    fb = Firebase()
    worker = args.worker or f"{socket.gethostname()}-{os.getpid()}"
    deadline = time.time() + args.max_minutes * 60 if args.max_minutes else float("inf")
    try:
        fb.set_cors()
    except Exception as e:  # noqa: BLE001
        log("Couldn't set Storage CORS (downloads in the app may fail):", e)
    log(f"Narrator {worker} ready.")
    while True:
        jobs = fb.jobs()
        if not jobs:
            if not args.loop:
                log("Nothing waiting.")
                return
            time.sleep(45)
            continue
        snap = jobs[0]
        ref = snap.reference
        if not fb.claim(ref, worker):
            continue
        d = ref.get().to_dict()
        log(f"Job {ref.id} ({d.get('kind')}): {d.get('title')}")
        try:
            with Lease(ref, worker):
                if d.get("kind") == "lv":
                    finished = run_align_job(fb, ref, d, deadline)
                else:
                    finished = run_tts_job(fb, ref, d, deadline)
            if not finished:
                ref.update({"leaseUntil": 0})
                return
        except Exception as e:  # noqa: BLE001
            log("Job failed:", repr(e))
            ref.update({"status": "error", "error": str(e)[:300], "leaseUntil": 0})
        if time.time() > deadline:
            return


def check(_args):
    fb = Firebase()
    n = len(fb.jobs())
    log(f"{n} job(s) waiting")
    out = os.environ.get("GITHUB_OUTPUT")
    if out:
        with open(out, "a") as f:
            f.write(f"work={'true' if n else 'false'}\n")


def add(args):
    fb = Firebase()
    if args.kind == "gb":
        meta = requests.get(f"https://gutendex.com/books/{args.id}", headers=UA, timeout=30).json()
        authors = " and ".join(textproc_flip(a["name"]) for a in meta.get("authors", [])[:2])
        fb.db.collection("narrations").document(f"gb-{args.id}").set({
            "kind": "gb", "gbId": int(args.id), "title": meta.get("title", ""), "author": authors,
            "cover": f"https://www.gutenberg.org/cache/epub/{args.id}/pg{args.id}.cover.medium.jpg",
            "voice": args.voice, "status": "queued", "chapters": [], "chaptersDone": 0, "chaptersTotal": 0,
            "createdAt": int(time.time() * 1000), "updatedAt": int(time.time() * 1000), "error": "",
        })
        log(f"Queued Gutenberg #{args.id}: {meta.get('title')}")


def textproc_flip(name):
    if "," in name:
        last, first = name.split(",", 1)
        return f"{re.sub(r'[(].*?[)]', '', first).strip()} {last.strip()}"
    return name


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = ap.add_subparsers(dest="cmd", required=True)
    w = sub.add_parser("work")
    w.add_argument("--loop", action="store_true", help="keep waiting for new jobs")
    w.add_argument("--max-minutes", type=float, default=0, help="stop starting new chapters after this long")
    w.add_argument("--worker", default="")
    sub.add_parser("check")
    a = sub.add_parser("add")
    a.add_argument("kind", choices=["gb"])
    a.add_argument("id")
    a.add_argument("--voice", default="af_heart")
    sub.add_parser("cors")
    args = ap.parse_args()
    if args.cmd == "work":
        work(args)
    elif args.cmd == "check":
        check(args)
    elif args.cmd == "add":
        add(args)
    elif args.cmd == "cors":
        Firebase().set_cors()
        log("Storage CORS set.")


if __name__ == "__main__":
    main()
