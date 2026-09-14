# CSV 산출물 생성 — 표준 라이브러리만 씁니다. 설치할 것이 없습니다.
#   python 이_파일.py
#
# 문서 안의 표를 각각 CSV 파일로 떨어뜨리고, 본문은 개요 CSV 로 만든다.
# 엑셀에서 바로 열 수 있도록 BOM 을 붙인다(한글 깨짐 방지).
__PARSER__

import csv

meta, blocks = parse(SRC)
made = []

def write(name, rows):
    with open(name, "w", newline="", encoding="utf-8-sig") as f:
        csv.writer(f).writerows(rows)
    made.append(name)

# ── 본문 개요 ────────────────────────────────────────────────────────
outline, section, sub = [["구분", "섹션", "하위", "내용"]], "", ""
for kind, val in blocks:
    if kind == "h1":
        continue
    elif kind == "h2":
        section, sub = val, ""
    elif kind in ("h3", "h4"):
        sub = val
    elif kind in ("p", "quote"):
        outline.append(["본문", section, sub, val])
    elif kind == "list":
        for it in val:
            outline.append(["목록", section, sub, it])
    elif kind == "code":
        outline.append(["코드", section, sub, val.replace("\n", " ⏎ ")])
write(OUT + "_개요.csv", outline)

# ── 표 ───────────────────────────────────────────────────────────────
n = 0
for kind, val in blocks:
    if kind == "table" and val:
        n += 1
        width = max(len(r) for r in val)
        write("%s_표%d.csv" % (OUT, n), [r + [""] * (width - len(r)) for r in val])

print("만들었습니다:")
for m in made:
    print("  " + m)
