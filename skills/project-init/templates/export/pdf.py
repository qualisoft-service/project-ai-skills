# PDF 산출물 생성
#   pip install reportlab
#   python 이_파일.py
#
# 한글은 reportlab 내장 CID 폰트를 쓴다. 폰트 파일을 따로 받지 않아도 된다.
__PARSER__

from reportlab.lib import colors
from reportlab.lib.enums import TA_LEFT
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib.units import mm
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.cidfonts import UnicodeCIDFont
from reportlab.platypus import (BaseDocTemplate, Frame, PageTemplate, Paragraph,
                                Spacer, Table, TableStyle, KeepTogether)

pdfmetrics.registerFont(UnicodeCIDFont("HYGothic-Medium"))
FONT = "HYGothic-Medium"

INK   = colors.HexColor("#1c1b19")
DIM   = colors.HexColor("#6b6862")
LINE  = colors.HexColor("#e4e2dd")
ACC   = colors.HexColor("#2383e2")
BAND  = colors.HexColor("#fafaf8")

def st(size, leading, color=INK, space_before=0, space_after=0, bold_gap=0):
    return ParagraphStyle("s%d" % size, fontName=FONT, fontSize=size, leading=leading,
                          textColor=color, spaceBefore=space_before, spaceAfter=space_after,
                          alignment=TA_LEFT, wordWrap="CJK")

S = {
    "title": st(26, 34, INK, 0, 4),
    "sub":   st(10, 15, DIM, 0, 22),
    "h2":    st(15, 21, INK, 20, 7),
    "h3":    st(12, 18, INK, 13, 4),
    "h4":    st(10.5, 16, INK, 10, 3),
    "p":     st(10, 17.5, INK, 0, 7),
    "quote": st(10, 17.5, DIM, 2, 9),
    "li":    st(10, 17, INK, 0, 3),
    "cell":  st(9, 13.5, INK),
    "cellh": st(9, 13.5, colors.white),
    "code":  ParagraphStyle("code", fontName="Courier", fontSize=8.5, leading=12.5,
                            textColor=INK, backColor=BAND, borderPadding=7,
                            spaceBefore=3, spaceAfter=9),
}

meta, blocks = parse(SRC)

def header_footer(canvas, doc):
    canvas.saveState()
    canvas.setFont(FONT, 7.5)
    canvas.setFillColor(DIM)
    canvas.drawString(20 * mm, A4[1] - 13 * mm, TITLE)
    canvas.drawRightString(A4[0] - 20 * mm, A4[1] - 13 * mm, meta.get("id", ""))
    canvas.setStrokeColor(LINE)
    canvas.setLineWidth(0.5)
    canvas.line(20 * mm, A4[1] - 16 * mm, A4[0] - 20 * mm, A4[1] - 16 * mm)
    canvas.drawCentredString(A4[0] / 2, 12 * mm, str(doc.page))
    canvas.restoreState()

def table_flow(rows, width):
    head, body = rows[0], rows[1:]
    data = [[Paragraph(c, S["cellh"]) for c in head]]
    data += [[Paragraph(c, S["cell"]) for c in r] for r in body]
    cols = len(head)
    t = Table(data, colWidths=[width / cols] * cols, repeatRows=1, hAlign="LEFT")
    style = [
        ("BACKGROUND", (0, 0), (-1, 0), INK),
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("TOPPADDING", (0, 0), (-1, -1), 7),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 7),
        ("LEFTPADDING", (0, 0), (-1, -1), 9),
        ("RIGHTPADDING", (0, 0), (-1, -1), 9),
        ("LINEBELOW", (0, 0), (-1, -1), 0.4, LINE),
        ("BOX", (0, 0), (-1, -1), 0.4, LINE),
    ]
    for i in range(1, len(data)):
        if i % 2 == 0:
            style.append(("BACKGROUND", (0, i), (-1, i), BAND))
    t.setStyle(TableStyle(style))
    return t

def build():
    doc = BaseDocTemplate(OUT + ".pdf", pagesize=A4,
                          leftMargin=20 * mm, rightMargin=20 * mm,
                          topMargin=22 * mm, bottomMargin=20 * mm,
                          title=TITLE, author=meta.get("owner", ""))
    frame = Frame(doc.leftMargin, doc.bottomMargin, doc.width, doc.height, id="f")
    doc.addPageTemplates([PageTemplate(id="p", frames=[frame], onPage=header_footer)])

    flow = [Paragraph(TITLE, S["title"])]
    bits = [meta.get(k, "") for k in ("id", "status", "owner", "updated")]
    flow.append(Paragraph("  ·  ".join([b for b in bits if b]), S["sub"]))

    for kind, val in blocks:
        if kind == "h1":
            continue
        elif kind == "h2":
            flow.append(Paragraph(val, S["h2"]))
        elif kind == "h3":
            flow.append(Paragraph(val, S["h3"]))
        elif kind == "h4":
            flow.append(Paragraph(val, S["h4"]))
        elif kind == "p":
            flow.append(Paragraph(val, S["p"]))
        elif kind == "quote":
            flow.append(Paragraph("│  " + val, S["quote"]))
        elif kind == "list":
            for it in val:
                flow.append(Paragraph("•  " + it, S["li"]))
            flow.append(Spacer(1, 6))
        elif kind == "code":
            flow.append(Paragraph(val.replace("&", "&amp;").replace("<", "&lt;")
                                  .replace("\n", "<br/>"), S["code"]))
        elif kind == "table" and val:
            flow.append(Spacer(1, 3))
            flow.append(table_flow(val, doc.width))
            flow.append(Spacer(1, 11))

    doc.build(flow)
    print("만들었습니다: " + OUT + ".pdf")

build()
