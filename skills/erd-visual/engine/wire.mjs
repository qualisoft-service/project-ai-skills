/* 배선 오케스트레이션 — Node 와 브라우저가 같은 경로를 타게 하는 단일 진입점 */

import { OrthoC, ports, spread } from './router.mjs';
import { isSys } from './layout.mjs';

/** 게이트·행 사이에 레인을 깔아 A* 가 쓸 수 있는 선을 늘린다 */
function lanes(lay) {
  const g = lay.geo;
  const X = [];
  const nCol = lay.columns.length;
  for (let i = 0; i < nCol - 1; i++) {
    const gx = g.PAD + i * (g.CW + g.GUT) + g.CW;
    for (let k = 1; k <= 10; k++) X.push(gx + g.GUT * k / 11);
  }
  X.push(g.PAD - 26, g.PAD + nCol * (g.CW + g.GUT) - g.GUT + g.CW + 26);

  const Y = [g.TOP + g.HEAD - 30, g.TOP + g.HEAD - 17, lay.H - 84, lay.H - 70, lay.H - 56];
  for (let j = 0; j < lay.maxRows; j++) {
    const yb = g.TOP + g.HEAD + j * (g.CH + g.CG) + g.CH;
    for (const k of [1, 2, 3]) Y.push(yb + g.CG * k / 4);
  }
  return { X, Y };
}

export function wire(model, lay) {
  const g = lay.geo;
  const nCol = lay.columns.length;
  const names = [...lay.pos.keys()];
  const NI = new Map(names.map((t, i) => [t, i]));
  const RECT = names.map(t => {
    const p = lay.pos.get(t);
    return { x: p.x, y: p.y, w: p.w, h: p.h };
  });
  const EDG = model.refs.map(r => [NI.get(r.from), NI.get(r.to)]);
  const skips = EDG.map(([a, b]) => new Set([a, b]));
  const L = lanes(lay);

  // ── 개별 배선 ────────────────────────────────────────────
  const { port } = ports(EDG, RECT, 9);
  const eBounds = { x1: 16, y1: g.TOP - 14, x2: lay.W - 16, y2: lay.H - g.FOOT + 40 };
  const RT = new OrthoC(RECT, lay.W, lay.H,
    { margin: 15, clear: 8, bounds: eBounds, lanesX: L.X, lanesY: L.Y, tol: 7.0, cong: 150.0 });

  // 긴 선부터. 짧은 선이 먼저 자리를 잡으면 긴 선이 크게 돈다.
  const order = model.refs.map((_, k) => k).sort((a, b) => {
    const da = Math.abs(lay.pos.get(model.refs[a].from).col - lay.pos.get(model.refs[a].to).col);
    const db = Math.abs(lay.pos.get(model.refs[b].from).col - lay.pos.get(model.refs[b].to).col);
    return db - da;
  });

  const raw = new Array(EDG.length);
  let fail = 0;
  for (const k of order) {
    const [ai, bi] = EDG[k];
    const p0 = port.get(k + '|a'), p1 = port.get(k + '|b');
    const pts = RT.route(p0, p1, new Set([ai, bi]), 340);
    if (!pts) { fail++; raw[k] = [p0, p1]; } else { RT.commit(pts); raw[k] = pts; }
  }
  const paths = spread(raw, RECT, skips, { gap: 9, tol: 7.0, rounds: 4, bounds: eBounds });

  // ── 도메인 번들 ──────────────────────────────────────────
  const cnt = new Map();
  for (const r of model.refs) {
    const ga = lay.pos.get(r.from).dom, gb = lay.pos.get(r.to).dom;
    if (ga === gb) continue;
    // 이스케이프로 쓴다 — 이유는 layout.mjs orderColumns 주석 참조
    const k = ga + '\u001f' + gb;
    cnt.set(k, (cnt.get(k) || 0) + 1);
  }
  const DIX = new Map(lay.domBounds.map((r, i) => [r.dom, i]));
  const bKeys = [], bEdges = [], bCount = [];
  for (const [k, n] of cnt) {
    const [ga, gb] = k.split('\u001f');
    if (!DIX.has(ga) || !DIX.has(gb)) continue;
    bKeys.push([ga, gb]);
    bEdges.push([DIX.get(ga), DIX.get(gb)]);
    bCount.push(n);
  }
  const bRect = lay.domBounds.map(r => ({ x: r.x, y: r.y, w: r.w, h: r.h }));
  const bSkips = bEdges.map(([a, b]) => new Set([a, b]));

  const bLanesX = [];
  for (let i = 0; i < nCol - 1; i++) {
    const gx = g.PAD + i * (g.CW + g.GUT) + g.CW;
    for (let k = 1; k <= 6; k++) bLanesX.push(gx + g.GUT * k / 7);
  }
  const y0 = lay.domBounds.length ? Math.min(...lay.domBounds.map(r => r.y)) : g.TOP;
  // 번들은 굵다(최대 7.6px). 캔버스 가장자리를 타면 테두리에 잘려 깨져 보이고,
  // 제목·범례 위로 지나가면 글자를 덮는다. 그래서 다닐 수 있는 띠를 좁혀 준다.
  const bBounds = { x1: 24, y1: g.TOP - 8, x2: lay.W - 24, y2: lay.H - g.FOOT + 26 };
  const bLanesY = [y0 - 46, y0 - 30, bBounds.y2 - 30, bBounds.y2 - 16, bBounds.y2 - 4]
    .filter(v => v >= bBounds.y1 && v <= bBounds.y2);

  const bp = ports(bEdges, bRect, 16).port;
  const BRT = new OrthoC(bRect, lay.W, lay.H,
    { margin: 20, clear: 11, bounds: bBounds, lanesX: bLanesX, lanesY: bLanesY,
      tol: 15.0, cong: 320.0 });
  const bOrder = bEdges.map((_, k) => k).sort((a, b) => bCount[b] - bCount[a]);
  const bRaw = new Array(bEdges.length);
  for (const k of bOrder) {
    const [ai, bi] = bEdges[k];
    const p0 = bp.get(k + '|a'), p1 = bp.get(k + '|b');
    const pts = BRT.route(p0, p1, new Set([ai, bi]), 380);
    if (pts) BRT.commit(pts);
    bRaw[k] = pts || [p0, p1];
  }
  const bundlePaths = spread(bRaw, bRect, bSkips,
    { gap: 17, tol: 13.0, rounds: 4, bounds: bBounds });

  return {
    names, RECT, EDG, skips, paths, fail,
    bundlePaths, bundleKeys: bKeys, bundleCount: bCount, bundleRect: bRect, bundleSkips: bSkips,
    isSysRef: model.refs.map(isSys),
  };
}
