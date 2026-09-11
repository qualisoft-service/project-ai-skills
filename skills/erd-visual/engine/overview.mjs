/* 조감도 — 고객 설명용 한 장.
 *
 * 전체 관계도가 "빠짐없이"를 목표로 한다면, 조감도는 "이해되게"가 목표다.
 * 그래서 배치는 자동이 아니라 **사람이 정한다**(overview.json).
 *
 * 대신 **연결선은 자동으로 대조한다.** 조감도의 화살표 하나하나가
 * DBML 의 실제 Ref 로 뒷받침되는지 검사하고, 근거가 없으면 빌드를 세운다.
 * 손으로 그린 그림은 언제든 사실과 어긋날 수 있기 때문이다.
 */

import { OrthoC, ports, spread, rounded } from './router.mjs';
import { fitText } from './verify.mjs';
import { INK, INK_2, INK_3, LINE, PAPER, PAPER_2, WIRE, PASTEL, esc } from './render.mjs';

/** 노드가 대표하는 테이블 집합 */
const tablesOf = n => (n.tables && n.tables.length ? n.tables : [n.id]);

/**
 * 조감도 명세를 DBML 과 대조한다.
 *  · edges  : 근거가 되는 Ref 가 하나라도 있어야 한다
 *  · gaps   : 양방향 모두 Ref 가 **없어야** 한다 (없다고 주장하는 선이므로)
 *  · nodes  : 가리키는 테이블이 실제로 있어야 한다
 */
export function verifyOverview(spec, model) {
  const nodes = new Map((spec.nodes || []).map(n => [n.id, n]));
  const refKey = new Set(model.refs.map(r => r.from + '>' + r.to));
  const known = model.tables;

  const missingTables = [], edgeNoEvidence = [], gapContradicted = [], badRef = [];

  for (const n of spec.nodes || []) {
    for (const t of tablesOf(n)) if (!known.has(t)) missingTables.push({ node: n.id, table: t });
  }

  const between = (a, b) => {
    const A = tablesOf(nodes.get(a) || { id: a });
    const B = tablesOf(nodes.get(b) || { id: b });
    const hits = [];
    for (const x of A) for (const y of B) {
      if (x === y) continue;
      for (const r of model.refs) if (r.from === x && r.to === y) hits.push(r);
    }
    return hits;
  };

  for (const e of spec.edges || []) {
    if (!nodes.has(e.from) || !nodes.has(e.to)) { badRef.push(e); continue; }
    const hits = between(e.from, e.to);
    if (!hits.length) edgeNoEvidence.push(e);
    else e._evidence = hits.map(r => r.from + '.' + r.col + ' > ' + r.to);
    e._count = hits.length;
  }

  for (const gp of spec.gaps || []) {
    if (!nodes.has(gp.from) || !nodes.has(gp.to)) { badRef.push(gp); continue; }
    const fwd = between(gp.from, gp.to), rev = between(gp.to, gp.from);
    gp._contradicted = !!(fwd.length || rev.length);
    if (gp._contradicted) gapContradicted.push({ ...gp, found: [...fwd, ...rev].slice(0, 3) });
  }

  return {
    ok: !missingTables.length && !edgeNoEvidence.length && !gapContradicted.length && !badRef.length,
    missingTables, edgeNoEvidence, gapContradicted, badRef,
    edges: (spec.edges || []).length,
    gaps: (spec.gaps || []).length,
  };
}

export function renderOverview(spec, model, opt = {}) {
  const W = spec.canvas?.w || 1720, H = spec.canvas?.h || 980;
  const nodes = spec.nodes || [];
  const NI = new Map(nodes.map((n, i) => [n.id, i]));

  // 그룹별 파스텔 — 지정이 없으면 등장 순서로 배정
  const gseen = [];
  for (const n of nodes) if (n.group && !gseen.includes(n.group)) gseen.push(n.group);
  const colorOf = n => {
    const i = n.group ? gseen.indexOf(n.group) : 0;
    return PASTEL[(i < 0 ? 0 : i) % PASTEL.length];
  };

  const RECT = nodes.map(n => ({ x: n.x, y: n.y, w: n.w, h: n.h }));
  // 콜아웃도 장애물 — 선이 뚫고 지나가면 안 된다
  const OBST = RECT.slice();
  const call = spec.callout;
  if (call) OBST.push({ x: call.x, y: call.y, w: call.w, h: call.h });

  const edges = spec.edges || [], gaps = spec.gaps || [];
  const ALL = [...edges, ...gaps].map(e => [NI.get(e.from), NI.get(e.to)]);

  const { port } = ports(ALL, RECT, 14);
  const lanesX = [], lanesY = [];
  for (const n of nodes) for (const k of [1, 2, 3]) {
    lanesX.push(n.x - 14 * k, n.x + n.w + 14 * k);
    lanesY.push(n.y - 13 * k, n.y + n.h + 13 * k);
  }
  const RT = new OrthoC(OBST, W, H, {
    margin: 16, clear: 10,
    lanesX: lanesX.filter(v => v > 20 && v < W - 20),
    lanesY: lanesY.filter(v => v > 20 && v < H - 20),
    tol: 11, cong: 260,
  });

  // 긴 선부터 — 짧은 선이 먼저 자리를 잡으면 긴 선이 크게 돈다
  const order = ALL.map((_, k) => k).sort((a, b) => {
    const d = k => Math.abs(RECT[ALL[k][0]].x - RECT[ALL[k][1]].x)
      + Math.abs(RECT[ALL[k][0]].y - RECT[ALL[k][1]].y);
    return d(b) - d(a);
  });
  const paths = new Array(ALL.length);
  for (const k of order) {
    const [ai, bi] = ALL[k];
    const p0 = port.get(k + '|a'), p1 = port.get(k + '|b');
    const pts = RT.route(p0, p1, new Set([ai, bi]), 300);
    if (pts) RT.commit(pts);
    paths[k] = pts || [p0, p1];
  }
  const skips = ALL.map(([a, b]) => new Set([a, b]));
  const out = spread(paths, OBST, skips, { gap: 11, tol: 9, rounds: 4 });

  const P = [], A = s => P.push(s);
  A('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ' + W + ' ' + H + '" id="overview" ' +
    'font-family="Pretendard, -apple-system, \'Apple SD Gothic Neo\', sans-serif">');
  A('<defs><marker id="ov-ah" viewBox="0 0 10 10" refX="8.5" refY="5" markerWidth="6" markerHeight="6" ' +
    'orient="auto-start-reverse"><path d="M0,1 L9,5 L0,9 z" fill="' + WIRE + '"/></marker></defs>');
  A('<rect width="' + W + '" height="' + H + '" fill="' + PAPER + '"/>');
  A('<text x="70" y="68" font-size="34" font-weight="800" fill="' + INK + '" letter-spacing="-.025em">' +
    esc(spec.title || '조감도') + '</text>');
  A('<text x="70" y="98" font-size="14.5" fill="' + INK_2 + '">' + esc(spec.subtitle || '') + '</text>');
  A('<line x1="70" y1="122" x2="' + (W - 70) + '" y2="122" stroke="' + INK + '" stroke-width="1.8"/>');

  for (const b of spec.bands || []) {
    A('<rect x="' + b.x + '" y="' + b.y + '" width="' + b.w + '" height="' + b.h +
      '" rx="16" fill="' + PAPER_2 + '" stroke="' + LINE + '" stroke-width="1.4"/>');
    A('<text x="' + (b.x + 20) + '" y="' + (b.y + 28) + '" font-size="12.5" font-weight="800" fill="' +
      INK_3 + '" letter-spacing=".14em">' + esc(b.label) + '</text>');
  }

  // 배선 — 근거를 잃은 선은 눈에 보이게 남긴다.
  // 편집으로 관계가 사라졌는데 그림만 그대로면 조용히 거짓이 된다.
  edges.forEach((e, k) => {
    const has = e._count === undefined ? true : e._count > 0;
    const n = e.weight || e._count || 1;
    A('<path class="ove' + (has ? '' : ' noev') + '" data-a="' + esc(e.from) + '" data-b="' +
      esc(e.to) + '" d="' + rounded(out[k], 10) + '" fill="none" stroke="' +
      (has ? WIRE : '#B42318') + '" stroke-width="' +
      (has ? (1.5 + Math.min(n, 8) * 0.34).toFixed(1) : '2.6') + '" opacity="' +
      (has ? '.5' : '.95') + '"' + (has ? '' : ' stroke-dasharray="3 5"') +
      ' marker-end="url(#ov-ah)"><title>' +
      esc(e.label || (e.from + ' → ' + e.to)) +
      (has ? ' · 외래키 ' + n + '건' : ' · ⚠ DBML 에 근거가 없습니다') + '</title></path>');
  });
  gaps.forEach((gp, j) => {
    const k = edges.length + j;
    const bad = gp._contradicted;
    A('<path class="ove gap' + (bad ? ' noev' : '') + '" data-a="' + esc(gp.from) + '" data-b="' +
      esc(gp.to) + '" d="' + rounded(out[k], 10) + '" fill="none" stroke="' +
      (bad ? '#B42318' : INK) + '" stroke-width="2.6" stroke-dasharray="8 6" opacity="' +
      (bad ? '.95' : '.9') + '"><title>' + esc(gp.title || '') + ' — ' +
      (bad ? '⚠ 실제로는 관계가 있습니다' : esc(gp.note || '외래키 없음')) + '</title></path>');
    const pts = out[k], mid = pts[Math.floor(pts.length / 2)];
    const prev = pts[Math.floor(pts.length / 2) - 1] || mid;
    const mx = (mid[0] + prev[0]) / 2, my = (mid[1] + prev[1]) / 2;
    A('<circle cx="' + mx.toFixed(0) + '" cy="' + my.toFixed(0) + '" r="14.5" fill="' + INK + '"/>');
    A('<text x="' + mx.toFixed(0) + '" y="' + (my + 5.5).toFixed(0) + '" font-size="14.5" ' +
      'font-weight="800" fill="' + PAPER + '" text-anchor="middle">' + (j + 1) + '</text>');
  });

  // 노드
  for (const n of nodes) {
    const [bg, ac] = colorOf(n);
    const deg = edges.filter(e => e.from === n.id || e.to === n.id).length;
    A('<g class="ovn" data-id="' + esc(n.id) + '" data-deg="' + deg + '"><title>' +
      esc(n.label) + ' · ' + esc(tablesOf(n).join(', ')) + '</title>');
    A('<rect class="hit" x="' + (n.x - 4) + '" y="' + (n.y - 4) + '" width="' + (n.w + 8) +
      '" height="' + (n.h + 8) + '" rx="15" fill="transparent"/>');
    A('<rect class="bd0" x="' + n.x + '" y="' + n.y + '" width="' + n.w + '" height="' + n.h +
      '" rx="12" fill="' + bg + '" stroke="' + INK + '" stroke-width="1.8"/>');
    A('<rect x="' + n.x + '" y="' + (n.y + 12) + '" width="5" height="' + (n.h - 24) +
      '" rx="2.5" fill="' + ac + '"/>');
    A('<text x="' + (n.x + 20) + '" y="' + (n.y + 31) + '" font-size="18" font-weight="800" fill="' +
      INK + '" letter-spacing="-.015em">' + esc(fitText(n.label, n.w - 34, 18)) + '</text>');
    A('<text x="' + (n.x + 20) + '" y="' + (n.y + 52) + '" font-size="11.5" font-weight="600" fill="' +
      INK_2 + '" font-family="ui-monospace, Menlo, monospace">' +
      esc(fitText(n.sub || tablesOf(n).join(' · '), n.w - 34, 11.5, 1.0, 0.62)) + '</text>');
    A('</g>');
  }

  // 콜아웃 — 끊긴 고리 설명
  if (call) {
    A('<rect x="' + call.x + '" y="' + call.y + '" width="' + call.w + '" height="' + call.h +
      '" rx="14" fill="' + PAPER + '" stroke="' + INK + '" stroke-width="2"/>');
    A('<rect x="' + call.x + '" y="' + call.y + '" width="' + call.w + '" height="40" rx="14" fill="' + INK + '"/>');
    A('<rect x="' + call.x + '" y="' + (call.y + 26) + '" width="' + call.w + '" height="14" fill="' + INK + '"/>');
    A('<text x="' + (call.x + 20) + '" y="' + (call.y + 27) + '" font-size="15" font-weight="800" fill="' +
      PAPER + '">' + esc(call.title || '확인이 필요한 곳') + '</text>');
    A('<text x="' + (call.x + 20) + '" y="' + (call.y + 60) + '" font-size="11.5" fill="' + INK_2 + '">' +
      esc(call.sub || '') + '</text>');
    gaps.forEach((gp, k) => {
      const yy = call.y + 60 + (k + 1) * 58;
      A('<circle cx="' + (call.x + 30) + '" cy="' + yy + '" r="11" fill="' + INK + '"/>');
      A('<text x="' + (call.x + 30) + '" y="' + (yy + 4.5) + '" font-size="12.5" font-weight="800" fill="' +
        PAPER + '" text-anchor="middle">' + (k + 1) + '</text>');
      A('<text x="' + (call.x + 50) + '" y="' + (yy - 2) + '" font-size="13" font-weight="800" fill="' +
        INK + '">' + esc(fitText(gp.title || '', call.w - 70, 13)) + '</text>');
      A('<text x="' + (call.x + 50) + '" y="' + (yy + 16) + '" font-size="11.5" fill="' + INK_2 + '">' +
        esc(fitText(gp.note || '', call.w - 70, 11.5)) + '</text>');
    });
    if (call.foot)
      A('<text x="' + (call.x + 20) + '" y="' + (call.y + call.h - 14) + '" font-size="11" fill="' +
        INK_3 + '">' + esc(fitText(call.foot, call.w - 40, 11)) + '</text>');
  }

  // 범례
  A('<line x1="70" y1="' + (H - 72) + '" x2="' + (W - 70) + '" y2="' + (H - 72) +
    '" stroke="' + LINE + '" stroke-width="1.2"/>');
  A('<g transform="translate(70,' + (H - 40) + ')" font-size="13" fill="' + INK_2 + '">');
  A('<path d="M0,-6 L22,-6 L22,-14 L44,-14" fill="none" stroke="' + WIRE + '" stroke-width="2.6" ' +
    'stroke-linejoin="round" opacity=".55" marker-end="url(#ov-ah)"/>');
  A('<text x="60" y="-1">실제 외래키 (DBML 대조 완료) · 선 굵기 = 참조 수</text>');
  if (gaps.length) {
    A('<path d="M470,-6 L502,-6" fill="none" stroke="' + INK + '" stroke-width="2.6" stroke-dasharray="8 6"/>');
    A('<circle cx="519" cy="-6" r="9.5" fill="' + INK + '"/>');
    A('<text x="538" y="-1" font-weight="700" fill="' + INK + '">없는 연결 — 좌측 박스 참조</text>');
  }
  A('</g></svg>');
  return P.join('\n');
}


/** 이 조감도 명세가 이 스키마에 해당하는가.
 *  스키마를 통째로 바꾸면 손으로 그린 그림은 '고칠 N건'이 아니라
 *  애초에 해당 없는 그림이다. 그 둘을 구분해야 한다. */
export function overviewFit(spec, model) {
  const nodes = (spec && spec.nodes) || [];
  if (!nodes.length) return { total: 0, alive: 0, ratio: 0, applicable: false };
  const alive = nodes.filter(n => tablesOf(n).some(t => model.tables.has(t))).length;
  const ratio = alive / nodes.length;
  return { total: nodes.length, alive, ratio, applicable: ratio >= 0.5 };
}

/** DBML 에서 조감도를 만든다 - 손으로 그린 명세가 없거나 안 맞을 때.
 *
 *  큐레이션된 조감도만큼 이야기를 담지는 못한다. 대신 틀리지 않는다 -
 *  전부 실제 Ref 에서 나온 것이고, 배치는 관계도와 같은 순서 계산을 쓴다.
 *  작은 스키마는 테이블 단위, 큰 스키마는 그룹 단위로 묶는다. */
export function autoOverview(model, lay, opt = {}) {
  const byTable = model.tables.size <= (opt.tableLimit || 14);
  const CW = 260, CH = 92, GX = 120, GY = 66, PADX = 70, TOP = 176;

  const nodes = [], edges = [];

  if (byTable) {
    const cells = [];
    for (const [t, p] of lay.pos) cells.push({ t, col: p.col, row: p.row, dom: p.dom });
    const cols = [...new Set(cells.map(c => c.col))].sort((a, b) => a - b);
    const cix = new Map(cols.map((c, i) => [c, i]));
    for (const c of cells) {
      const m = model.tables.get(c.t);
      nodes.push({
        id: c.t, label: m.label || c.t, sub: c.t, group: c.dom, tables: [c.t],
        x: PADX + cix.get(c.col) * (CW + GX),
        y: TOP + c.row * (CH + GY), w: CW, h: CH,
      });
    }
    const seen = new Set();
    for (const r of model.refs) {
      if (r.from === r.to) continue;
      const k = r.from + '>' + r.to;
      if (seen.has(k)) continue;
      seen.add(k);
      const n = model.refs.filter(x => x.from === r.from && x.to === r.to).length;
      edges.push({ from: r.from, to: r.to, label: r.col + (n > 1 ? ' 외 ' + (n - 1) : ''), weight: n });
    }
  } else {
    const cnt = new Map();
    for (const r of model.refs) {
      const a = lay.pos.get(r.from).dom, b = lay.pos.get(r.to).dom;
      if (a === b) continue;
      cnt.set(a + ' ' + b, (cnt.get(a + ' ' + b) || 0) + 1);
    }
    const per = Math.max(1, Math.ceil(Math.sqrt(lay.order.length)));
    lay.order.forEach((d, i) => {
      const members = lay.cols.get(d) || [];
      if (!members.length) return;
      nodes.push({
        id: d, label: d, sub: members.length + '개 테이블 · ' + members.slice(0, 2).join(', '),
        group: d, tables: members,
        x: PADX + (i % per) * (CW + GX),
        y: TOP + Math.floor(i / per) * (CH + GY), w: CW, h: CH,
      });
    });
    const ids = new Set(nodes.map(n => n.id));
    for (const [k, n] of cnt) {
      const [a, b] = k.split(' ');
      if (!ids.has(a) || !ids.has(b)) continue;
      edges.push({ from: a, to: b, label: '외래키 ' + n + '건', weight: n });
    }
  }

  const W = Math.max(...nodes.map(n => n.x + n.w), 900) + PADX;
  const H = Math.max(...nodes.map(n => n.y + n.h), 500) + 110;

  return {
    _auto: true,
    title: opt.title || (byTable ? '테이블 관계 한눈에' : '그룹 흐름 한눈에'),
    subtitle: '테이블 ' + model.tables.size + ' · 관계 ' + model.refs.length +
      ' - DBML 에서 자동 생성했습니다. 모든 선은 실제 외래키입니다' +
      (byTable ? '' : ' (그룹 사이 참조를 묶었습니다)'),
    canvas: { w: W, h: H },
    bands: [], gaps: [], callout: null,
    nodes, edges,
  };
}
