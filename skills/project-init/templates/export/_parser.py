# ── 마크다운 읽기 ────────────────────────────────────────────────────
# 이 문서 체계가 쓰는 문법만 다룬다. 범용 파서가 아니다.
import re, pathlib

SRC = "__DOC_FILE__"
TITLE = "__DOC_TITLE__"
OUT = "__DOC_STEM__"

def parse(path):
    text = pathlib.Path(path).read_text(encoding="utf-8")
    meta = {}
    m = re.match(r"^---\n(.*?)\n---\n", text, re.S)
    if m:
        for line in m.group(1).splitlines():
            if ": " in line:
                k, v = line.split(": ", 1)
                meta[k.strip()] = v.strip()
        text = text[m.end():]
    blocks, lines, i = [], text.split("\n"), 0
    while i < len(lines):
        ln = lines[i]
        if ln.startswith("```"):
            j, buf = i + 1, []
            while j < len(lines) and not lines[j].startswith("```"):
                buf.append(lines[j]); j += 1
            blocks.append(("code", "\n".join(buf))); i = j + 1; continue
        if re.match(r"^#{1,4} ", ln):
            lvl = len(ln) - len(ln.lstrip("#"))
            blocks.append(("h%d" % lvl, ln[lvl:].strip())); i += 1; continue
        if ln.startswith("|") and i + 1 < len(lines) and re.match(r"^\|[\s:|-]+\|\s*$", lines[i + 1]):
            rows = []
            while i < len(lines) and lines[i].startswith("|"):
                cells = [plain(c.strip()) for c in lines[i].strip().strip("|").split("|")]
                if not re.match(r"^[\s:|-]+$", "".join(cells)):
                    rows.append(cells)
                i += 1
            blocks.append(("table", rows)); continue
        if re.match(r"^\s*[-*] ", ln):
            items = []
            while i < len(lines) and re.match(r"^\s*[-*] ", lines[i]):
                items.append(plain(re.sub(r"^\s*[-*] ", "", lines[i]))); i += 1
            blocks.append(("list", items)); continue
        if ln.startswith("> "):
            blocks.append(("quote", plain(ln[2:].strip()))); i += 1; continue
        if ln.strip():
            buf = []
            while i < len(lines) and lines[i].strip() and not re.match(r"^(#{1,4} |\||\s*[-*] |> |```)", lines[i]):
                buf.append(lines[i].strip()); i += 1
            blocks.append(("p", plain(" ".join(buf)))); continue
        i += 1
    return meta, blocks

def plain(s):
    s = re.sub(r"\[\[([^\]]+)\]\]", r"\1", s)
    s = re.sub(r"\*\*([^*]+)\*\*", r"\1", s)
    s = re.sub(r"`([^`]+)`", r"\1", s)
    s = re.sub(r"\[([^\]]+)\]\([^)]+\)", r"\1", s)
    return s.strip()
