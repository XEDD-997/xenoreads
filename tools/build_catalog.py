"""Build the Xenoreads catalog from LibriVox + Project Gutenberg (via Gutendex).

Writes:
  <out>/index.json          compact list of works: [title, author, catMask, lvId, gbId, seconds, iaId, popularity, sections]
  <out>/d/lv-<n>.json       LibriVox descriptions and chapter lists (sharded by id % 128)
  <out>/d/gb-<n>.json       Gutenberg summaries (sharded by id % 128)

Usage: python tools/build_catalog.py web/catalog
Env:   LV_LANGS=English   GB_PAGES=90   LV_MAX_PAGES=0 (0 = all)
"""
import json
import os
import re
import sys
import time
from concurrent.futures import ThreadPoolExecutor

import requests

OUT = sys.argv[1] if len(sys.argv) > 1 else "web/catalog"
LV_LANGS = {x.strip() for x in os.environ.get("LV_LANGS", "English").split(",") if x.strip()}
GB_PAGES = int(os.environ.get("GB_PAGES", "90"))
LV_MAX_PAGES = int(os.environ.get("LV_MAX_PAGES", "0"))
S = requests.Session()
S.headers["User-Agent"] = "Xenoreads-catalog/1.0 (personal audiobook app)"

CATS = [
    ("classics", r"classic|literary fiction|general fiction|best books ever|harvard classics|novels"),
    ("mystery", r"myster|detective|crime|thriller|suspense|sherlock"),
    ("scifi", r"science fiction|sci-fi"),
    ("fantasy", r"fantasy"),
    ("adventure", r"adventure|sea stories|western|action|travel"),
    ("romance", r"romance|love stor"),
    ("horror", r"horror|ghost|gothic|supernatural|vampire"),
    ("short", r"short stor|short fiction"),
    ("poetry", r"poetry|poems|verse|ballad"),
    ("philosophy", r"philosoph|ethics|stoic|metaphysic"),
    ("history", r"histor"),
    ("biography", r"biograph|autobiograph|memoir|diar"),
    ("myths", r"myth|legend|folklore|fairy tale|epic|saga"),
    ("children", r"children|juvenile|nursery|young reader"),
    ("humor", r"humou?r|satire|comed|comic"),
    ("plays", r"drama|plays|theat|tragedies"),
    ("religion", r"religio|christian|bible|spiritual|theolog|sermon"),
    ("science", r"\bscience\b|nature|natural history|biolog|astronom|physics|animals|evolution"),
    ("essays", r"essay|letters|correspondence|speech|lecture"),
    ("war", r"\bwar\b|military|battle"),
]
CAT_RE = [re.compile(p, re.I) for _, p in CATS]


def cat_mask(labels, popular=False):
    text = " | ".join(labels)
    mask = 0
    for i, rx in enumerate(CAT_RE):
        probe = re.sub(r"science fiction", "", text, flags=re.I) if CATS[i][0] == "science" else text
        if rx.search(probe):
            mask |= 1 << i
    if popular:
        mask |= 1
    return mask


def get_json(url, tries=5, timeout=90):
    for k in range(tries):
        try:
            r = S.get(url, timeout=timeout)
            if r.status_code == 404:
                return None
            r.raise_for_status()
            return r.json()
        except Exception as e:  # noqa: BLE001 - retry anything
            if k == tries - 1:
                print(f"  giving up on {url}: {e}", flush=True)
                return None
            time.sleep(2 + k * 4)


def clean(s):
    s = re.sub(r"<[^>]+>", " ", s or "")
    s = s.replace("&nbsp;", " ").replace("&amp;", "&").replace("&quot;", '"').replace("&#39;", "'")
    return re.sub(r"\s+", " ", s).strip()


def https(u):
    return re.sub(r"^http://", "https://", u or "")


# ---------------- LibriVox ----------------
def lv_page(offset):
    url = f"https://librivox.org/api/feed/audiobooks/?format=json&extended=1&limit=50&offset={offset}"
    j = get_json(url)
    return (j or {}).get("books") or []


def librivox():
    books, offset, page = [], 0, 0
    with ThreadPoolExecutor(4) as ex:
        while True:
            offsets = [offset + 50 * i for i in range(8)]
            pages = list(ex.map(lv_page, offsets))
            for p in pages:
                books.extend(p)
            page += len(offsets)
            offset += 50 * len(offsets)
            print(f"LibriVox: {len(books)} records", flush=True)
            if not pages[-1] or (LV_MAX_PAGES and page >= LV_MAX_PAGES):
                break
    return books


def author_name(authors):
    names = []
    for a in authors or []:
        n = f"{a.get('first_name', '')} {a.get('last_name', '')}".strip()
        if n:
            names.append(n)
    if len(names) > 2:
        return "Various"
    return " and ".join(names)


def norm_title(t):
    t = re.sub(r"\((version|dramatic reading|abridged)[^)]*\)", "", t, flags=re.I)
    return re.sub(r"[^a-z0-9]+", " ", t.lower()).strip()


# ---------------- Gutenberg ----------------
def gb_page(n):
    j = get_json(f"https://gutendex.com/books/?languages=en&page={n}")
    return (j or {}).get("results") or []


def gutenberg():
    out = []
    with ThreadPoolExecutor(4) as ex:
        for res in ex.map(gb_page, range(1, GB_PAGES + 1)):
            out.extend(res)
    print(f"Gutenberg: {len(out)} records", flush=True)
    return out


def flip(name):
    if "," in name:
        last, first = name.split(",", 1)
        first = re.sub(r"\(.*?\)", "", first).strip()
        return f"{first} {last.strip()}".strip()
    return name


def main():
    os.makedirs(os.path.join(OUT, "d"), exist_ok=True)
    gb = {b["id"]: b for b in gutenberg() if b.get("id")}
    lv_raw = librivox()

    shards_lv, shards_gb = {}, {}
    works = {}

    # LibriVox works, one recording per title (prefer solo, newest, not dramatic)
    best = {}
    for b in lv_raw:
        if b.get("language") not in LV_LANGS:
            continue
        secs = int(b.get("totaltimesecs") or 0)
        sections = [s for s in (b.get("sections") or []) if s.get("listen_url")]
        if not secs or not sections:
            continue
        author = author_name(b.get("authors"))
        key = (norm_title(b.get("title", "")), author.lower())
        dramatic = "dramatic" in (b.get("title") or "").lower()
        score = (0 if dramatic else 1, int(b["id"]))
        if key not in best or score > best[key][0]:
            best[key] = (score, b, sections, secs, author)

    for _, b, sections, secs, author in best.values():
        lid = int(b["id"])
        m = re.search(r"gutenberg\.org/(?:ebooks|etext|files|cache/epub)/(\d+)", b.get("url_text_source") or "")
        gid = int(m.group(1)) if m else 0
        g = gb.get(gid)
        ia = (re.search(r"archive\.org/details/([^/?#]+)", b.get("url_iarchive") or "") or [None, ""])[1]
        labels = [x.get("name", "") for x in b.get("genres") or []]
        pop = 0
        if g:
            labels += (g.get("subjects") or []) + (g.get("bookshelves") or [])
            pop = int(g.get("download_count") or 0)
        title = re.sub(r"\s*\((version \d+|solo|abridged)[^)]*\)\s*", " ", b.get("title") or "").strip()
        works[f"lv-{lid}"] = [title, author, cat_mask(labels, pop > 15000), lid, gid, secs, ia, pop, len(sections)]
        shards_lv.setdefault(lid % 128, {})[lid] = {
            "d": clean(b.get("description"))[:1600],
            "s": [[clean(s.get("title")) or f"Section {i + 1}", https(s["listen_url"]), int(s.get("playtime") or 0)] for i, s in enumerate(sections)],
        }

    linked = {w[4] for w in works.values() if w[4]}
    for gid, g in gb.items():
        if gid in linked:
            continue
        if not any("text/plain" in k for k in (g.get("formats") or {})):
            continue
        author = " and ".join(flip(a.get("name", "")) for a in (g.get("authors") or [])[:2]) or "Unknown"
        labels = (g.get("subjects") or []) + (g.get("bookshelves") or [])
        pop = int(g.get("download_count") or 0)
        title = re.sub(r"\s+", " ", g.get("title") or "").strip()
        works[f"gb-{gid}"] = [title, author, cat_mask(labels, pop > 15000), 0, gid, 0, "", pop, 0]
        summ = " ".join(g.get("summaries") or [])
        if summ:
            shards_gb.setdefault(gid % 128, {})[gid] = {"d": clean(summ)[:1600], "s": []}

    rows = sorted(works.values(), key=lambda w: -w[7])
    with open(os.path.join(OUT, "index.json"), "w", encoding="utf-8") as f:
        json.dump({"v": 1, "built": int(time.time()), "w": rows}, f, ensure_ascii=False, separators=(",", ":"))
    for kind, shards in (("lv", shards_lv), ("gb", shards_gb)):
        for n in range(128):
            with open(os.path.join(OUT, "d", f"{kind}-{n}.json"), "w", encoding="utf-8") as f:
                json.dump(shards.get(n, {}), f, ensure_ascii=False, separators=(",", ":"))
    print(f"Catalog: {len(rows)} works ({len(best)} LibriVox, {len(rows) - len(best)} text-only)")
    if len(rows) < 50:
        sys.exit("Catalog looks empty; keeping the previous one.")


if __name__ == "__main__":
    main()
