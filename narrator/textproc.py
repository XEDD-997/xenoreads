"""Turn raw book/article text into chapters of paragraphs of sentences."""
import re

WORDNUM = "one two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen sixteen seventeen eighteen nineteen twenty".split()
HEAD_RE = re.compile(
    r"^(?P<kw>chapter|book|part|stave|letter|act|canto|volume|section|adventure|story)\s+"
    r"(?P<num>[ivxlcdm]+|\d+|" + "|".join(WORDNUM) + r"|the\s+\w+)\b[.:\s]*(?P<rest>.{0,90})$",
    re.I,
)
ROMAN_ONLY = re.compile(r"^(?P<num>[IVXLC]{1,8})\.?$")
ABBR = re.compile(r"\b(Mr|Mrs|Ms|Dr|St|Jr|Sr|Mt|Prof|Capt|Col|Gen|Lt|Rev|Hon|vs|etc|No|Vol|Ch|Fig|viz|i\.e|e\.g)\.$", re.I)


def roman_to_int(s):
    vals = {"i": 1, "v": 5, "x": 10, "l": 50, "c": 100, "d": 500, "m": 1000}
    s = s.lower()
    if not s or any(c not in vals for c in s):
        return None
    total = 0
    for a, b in zip(s, s[1:] + " "):
        v = vals[a]
        total += -v if b != " " and vals.get(b, 0) > v else v
    return total


def strip_gutenberg(text):
    text = text.replace("\r\n", "\n").replace("\r", "\n").lstrip("﻿")
    m = re.search(r"\*{3}\s*START OF (?:THE|THIS) PROJECT GUTENBERG E-?BOOK[^\n]*\*{3}", text, re.I)
    if m:
        text = text[m.end():]
    m = re.search(r"\*{3}\s*END OF (?:THE|THIS) PROJECT GUTENBERG E-?BOOK", text, re.I)
    if m:
        text = text[: m.start()]
    text = re.sub(r"^\s*(Produced by|Transcribed from|E-text prepared by|Transcriber.s Note)[^\n]*(\n[^\n]+)*", "", text, flags=re.I)
    return text.strip()


def smart_quotes(p):
    p = re.sub(r'(^|[\s(\[\u2014-])"', "\\1\u201C", p)
    p = p.replace('"', "\u201D")
    p = re.sub(r"(\w)'", "\\1\u2019", p)
    p = re.sub(r"(^|[\s(\[\u2014-])'", "\\1\u2018", p)
    return p.replace("'", "\u2019")


def clean_para(p):
    p = re.sub(r"\s+", " ", p).strip()
    p = smart_quotes(p)
    p = re.sub(r"\[(Illustration|Footnote|Sidenote|Transcriber)[^\]]*\]", "", p, flags=re.I)
    p = re.sub(r"\[\d+\]|\{\d+\}", "", p)
    p = re.sub(r"_([^_]+)_", r"\1", p)
    p = p.replace("--", "—").replace(" ,", ",")
    return p.strip()


def paragraphs(text):
    out = []
    for block in re.split(r"\n\s*\n+", text):
        p = clean_para(block)
        if p and not re.fullmatch(r"[*\s.\-_=~#]+", p):
            out.append(p)
    return out


def words(s):
    return len(s.split())


def is_heading(p):
    if len(p) > 110 or words(p) > 14 or p.endswith((",", ";")):
        return None
    m = HEAD_RE.match(p)
    if m:
        return m
    m = ROMAN_ONLY.match(p)
    return m


def nice_title(p):
    t = p.strip().rstrip(".")
    if t.isupper():
        t = t.title()
        t = re.sub(r"\b([IVXLCDM]+)\b", lambda m: m.group(1).upper(), t, flags=re.I)
    return t


def spoken_title(title):
    def num(m):
        n = roman_to_int(m.group(2))
        return f"{m.group(1)} {n}" if n else m.group(0)
    s = re.sub(r"^(Chapter|Book|Part|Stave|Letter|Act|Canto|Volume|Section)\s+([IVXLCDM]+)\b", num, title, flags=re.I)
    if ROMAN_ONLY.match(title.strip() + "."):
        n = roman_to_int(title.strip().rstrip("."))
        if n:
            s = f"Chapter {n}"
    return s


def chapters_from_book(text, target_words=4500, max_words=14000):
    paras = paragraphs(strip_gutenberg(text))
    heads = []
    for i, p in enumerate(paras):
        if is_heading(p):
            heads.append(i)

    segs = []
    for k, i in enumerate(heads):
        j = heads[k + 1] if k + 1 < len(heads) else len(paras)
        body = paras[i + 1: j]
        title = nice_title(paras[i])
        # A short line right after the heading is usually its subtitle.
        if body and len(body[0]) < 80 and words(body[0]) <= 12 and not body[0].endswith((",", ";")) and not is_heading(body[0]):
            if not re.search(r"[.!?\"”]$", body[0]) or len(body[0]) < 40:
                title = f"{title}: {nice_title(body[0])}"
                body = body[1:]
        segs.append((title, body))

    real = [(t, b) for t, b in segs if sum(words(x) for x in b) >= 150]
    chapters = []
    if len(real) >= 3:
        first = heads[0] if heads else 0
        pre = paras[:first]
        if 1500 <= sum(words(x) for x in pre) <= 20000:
            chapters.append(("Introduction", pre))
        chapters += real
    else:
        chapters = chunk(paras, target_words, "Part")

    final = []
    for title, body in chapters:
        if sum(words(x) for x in body) > max_words:
            parts = chunk(body, target_words * 2, None)
            for n, (_, b) in enumerate(parts):
                final.append((f"{title}, part {n + 1}" if len(parts) > 1 else title, b))
        else:
            final.append((title, body))
    return [{"title": t, "spoken": spoken_title(t), "paragraphs": b} for t, b in final if b]


def chunk(paras, target, label):
    out, cur, n = [], [], 0
    for p in paras:
        cur.append(p)
        n += words(p)
        if n >= target:
            out.append((f"{label} {len(out) + 1}" if label else "", cur))
            cur, n = [], 0
    if cur:
        if out and n < target * 0.3:
            out[-1] = (out[-1][0], out[-1][1] + cur)
        else:
            out.append((f"{label} {len(out) + 1}" if label else "", cur))
    return out


def sentences(paragraph, max_len=300):
    parts = re.findall(r"[^.!?…]+(?:[.!?…]+[\"'”’)\]]*|$)\s*", paragraph) or [paragraph]
    out, buf = [], ""
    for k, part in enumerate(parts):
        buf += part
        t = buf.strip()
        if not t:
            continue
        nxt = parts[k + 1].lstrip() if k + 1 < len(parts) else ""
        if ABBR.search(t) or re.search(r"(?:^|[\s.])[a-zA-Z]\.$", t) or (nxt[:1].islower()):
            continue
        out.append(t)
        buf = ""
    if buf.strip():
        out.append(buf.strip())
    final = []
    for s in out:
        while len(s) > max_len:
            cut = max(s.rfind("; ", 0, max_len), s.rfind(": ", 0, max_len), s.rfind(", ", 0, max_len))
            if cut < max_len * 0.4:
                cut = s.rfind(" ", 0, max_len)
            if cut <= 0:
                break
            final.append(s[: cut + 1].strip())
            s = s[cut + 1:].strip()
        if s:
            final.append(s)
    return final


def for_speech(s):
    """Tidy a display sentence into something the voice reads naturally."""
    s = s.replace("&c.", "etc.").replace("—", ", ").replace("–", ", ")
    s = re.sub(r"\bMr\.", "Mister", s)
    s = re.sub(r"\bMrs\.", "Missus", s)
    s = re.sub(r"\bDr\.", "Doctor", s)
    s = re.sub(r"\bSt\. (?=[A-Z])", "Saint ", s)
    s = re.sub(r"[*\[\]{}<>]", "", s)
    s = re.sub(r"\s+,", ",", s)
    return re.sub(r"\s+", " ", s).strip()


def chapters_from_article(title, text, target_words=9000):
    paras = [clean_para(p) for p in re.split(r"\n\s*\n+|\n(?=\S)", text) if clean_para(p)]
    total = sum(words(p) for p in paras)
    if total <= target_words:
        return [{"title": title or "Article", "spoken": title or "", "paragraphs": paras}]
    parts = chunk(paras, target_words // 2, None)
    return [{"title": f"{title}, part {i + 1}", "spoken": f"{title}, part {i + 1}" if i == 0 else f"Part {i + 1}", "paragraphs": b} for i, (_, b) in enumerate(parts)]
