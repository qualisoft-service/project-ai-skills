/* 직각 배선 라우터 — Hanan 격자 + 굴곡 페널티 A* + 혼잡도 + 채널 분산
 *
 * 혼잡도 인식이 핵심이다. 없으면 A* 가 모든 선을 같은 격자선에 몰아넣어
 * 완전히 겹친다. 이미 지나간 선이 쓴 레인은 비싸지고, 뒤에 오는 선이
 * 알아서 옆 레인으로 우회한다.
 */

/** 이진 힙 — 삽입 순서를 tiebreak 으로 써서 결과를 결정적으로 만든다 */
class Heap {
  constructor() { this.a = []; this.n = 0; }
  push(f, v) {
    this.a.push([f, this.n++, v]);
    let i = this.a.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (this.a[p][0] < this.a[i][0] || (this.a[p][0] === this.a[i][0] && this.a[p][1] <= this.a[i][1])) break;
      [this.a[p], this.a[i]] = [this.a[i], this.a[p]];
      i = p;
    }
  }
  pop() {
    const top = this.a[0], last = this.a.pop();
    if (this.a.length) {
      this.a[0] = last;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1, r = l + 1;
        let s = i;
        if (l < this.a.length && (this.a[l][0] < this.a[s][0] ||
            (this.a[l][0] === this.a[s][0] && this.a[l][1] < this.a[s][1]))) s = l;
        if (r < this.a.length && (this.a[r][0] < this.a[s][0] ||
            (this.a[r][0] === this.a[s][0] && this.a[r][1] < this.a[s][1]))) s = r;
        if (s === i) break;
        [this.a[s], this.a[i]] = [this.a[i], this.a[s]];
        i = s;
      }
    }
    return top;
  }
  get size() { return this.a.length; }
}

export function simplify(pts) {
  const out = [pts[0]];
  for (const p of pts.slice(1)) {
    if (out.length >= 2) {
      const a = out[out.length - 2], b = out[out.length - 1];
      if ((a[0] === b[0] && b[0] === p[0]) || (a[1] === b[1] && b[1] === p[1])) {
        out[out.length - 1] = p;
        continue;
      }
    }
    const last = out[out.length - 1];
    if (p[0] !== last[0] || p[1] !== last[1]) out.push(p);
  }
  return out;
}

/** 채널 분산이 남긴 미세 꺾임(1~2px 계단)을 없앤다. 직각은 유지한다. */
export function snap(pts, eps = 3.0) {
  if (!pts || pts.length < 3) return pts;
  const q = pts.map(p => [p[0], p[1]]);
  for (let i = 0; i < q.length - 1; i++) {
    const dx = Math.abs(q[i + 1][0] - q[i][0]);
    const dy = Math.abs(q[i + 1][1] - q[i][1]);
    if (dx > 0 && dx < eps && dy < 0.01) {
      if (i + 1 < q.length - 1) q[i + 1][0] = q[i][0]; else q[i][0] = q[i + 1][0];
    } else if (dy > 0 && dy < eps && dx < 0.01) {
      if (i + 1 < q.length - 1) q[i + 1][1] = q[i][1]; else q[i][1] = q[i + 1][1];
    }
  }
  return simplify(q.map(p => [p[0], p[1]]));
}

/** 경로가 사각형 내부를 지나는가. skip 은 출발/도착 인덱스 집합. */
export function pierces(pts, rects, skip, inset = 1.5) {
  for (let i = 0; i < pts.length - 1; i++) {
    const [x1, y1] = pts[i], [x2, y2] = pts[i + 1];
    const loX = Math.min(x1, x2), hiX = Math.max(x1, x2);
    const loY = Math.min(y1, y2), hiY = Math.max(y1, y2);
    for (let j = 0; j < rects.length; j++) {
      if (skip && skip.has(j)) continue;
      const r = rects[j];
      if (hiX <= r.x + inset || loX >= r.x + r.w - inset) continue;
      if (hiY <= r.y + inset || loY >= r.y + r.h - inset) continue;
      return true;
    }
  }
  return false;
}

/** 직각 꺾임을 둥글게 — SVG path d */
export function rounded(pts, r = 9) {
  if (!pts || pts.length < 2) return '';
  const f = n => n.toFixed(1);
  const d = ['M' + f(pts[0][0]) + ',' + f(pts[0][1])];
  for (let i = 1; i < pts.length - 1; i++) {
    const a = pts[i - 1], b = pts[i], c = pts[i + 1];
    const v1 = [b[0] - a[0], b[1] - a[1]], v2 = [c[0] - b[0], c[1] - b[1]];
    const l1 = Math.abs(v1[0]) + Math.abs(v1[1]);
    const l2 = Math.abs(v2[0]) + Math.abs(v2[1]);
    const rr = Math.min(r, l1 / 2, l2 / 2);
    if (rr < 1) { d.push('L' + f(b[0]) + ',' + f(b[1])); continue; }
    const u1 = [l1 ? v1[0] / l1 : 0, l1 ? v1[1] / l1 : 0];
    const u2 = [l2 ? v2[0] / l2 : 0, l2 ? v2[1] / l2 : 0];
    const p1 = [b[0] - u1[0] * rr, b[1] - u1[1] * rr];
    const p2 = [b[0] + u2[0] * rr, b[1] + u2[1] * rr];
    d.push('L' + f(p1[0]) + ',' + f(p1[1]));
    d.push('Q' + f(b[0]) + ',' + f(b[1]) + ' ' + f(p2[0]) + ',' + f(p2[1]));
  }
  const e = pts[pts.length - 1];
  d.push('L' + f(e[0]) + ',' + f(e[1]));
  return d.join(' ');
}

export class Ortho {
  constructor(rects, W, H, { margin = 16, clear = 9, bounds = null } = {}) {
    this.R = rects.map(r => ({ x: r.x - clear, y: r.y - clear, w: r.w + 2 * clear, h: r.h + 2 * clear }));
    this.W = W; this.H = H; this.margin = margin;
    // 배선이 돌아다닐 수 있는 범위. 지정하지 않으면 캔버스 가장자리 8px 안쪽.
    // 굵은 선(번들)은 가장자리에 붙으면 테두리에 잘려 깨져 보인다.
    this.b = bounds || { x1: 8, y1: 8, x2: W - 8, y2: H - 8 };
    // 열 단위 공간 색인 — 같은 x/w 를 쓰는 카드를 묶어 충돌 검사를 줄인다
    const band = new Map();
    this.R.forEach((r, i) => {
      const k = r.x + '|' + r.w;
      if (!band.has(k)) band.set(k, { x: r.x, w: r.w, m: [] });
      band.get(k).m.push([i, r.y, r.y + r.h]);
    });
    this.bands = [...band.values()];
    this.lanesX = []; this.lanesY = [];
  }

  lines(extraX, extraY) {
    const xs = new Set([this.b.x1, this.b.x2]), ys = new Set([this.b.y1, this.b.y2]);
    for (const r of this.R) {
      xs.add(r.x - this.margin); xs.add(r.x + r.w + this.margin);
      ys.add(r.y - this.margin); ys.add(r.y + r.h + this.margin);
    }
    for (const v of extraX) xs.add(v);
    for (const v of this.lanesX) xs.add(v);
    for (const v of extraY) ys.add(v);
    for (const v of this.lanesY) ys.add(v);
    // 포트는 사각형 변이라 범위 밖일 수 있다 — 그건 통과시킨다
    const keepX = new Set(extraX), keepY = new Set(extraY);
    return [
      [...xs].filter(v => keepX.has(v) || (v >= this.b.x1 && v <= this.b.x2)).sort((a, b) => a - b),
      [...ys].filter(v => keepY.has(v) || (v >= this.b.y1 && v <= this.b.y2)).sort((a, b) => a - b),
    ];
  }

  blocked(x1, y1, x2, y2, skip) {
    const loX = Math.min(x1, x2), hiX = Math.max(x1, x2);
    const loY = Math.min(y1, y2), hiY = Math.max(y1, y2);
    for (const b of this.bands) {
      if (hiX <= b.x || loX >= b.x + b.w) continue;
      for (const [i, ry1, ry2] of b.m) {
        if (skip && skip.has(i)) continue;
        if (hiY <= ry1 || loY >= ry2) continue;
        return true;
      }
    }
    return false;
  }

  segCost() { return 0; }   // 하위 클래스가 혼잡도를 얹는다

  route(p0, p1, skip, bend = 300) {
    const [xs, ys] = this.lines([p0[0], p1[0]], [p0[1], p1[1]]);
    const xi = new Map(xs.map((v, i) => [v, i]));
    const yi = new Map(ys.map((v, i) => [v, i]));
    if (!xi.has(p0[0]) || !xi.has(p1[0]) || !yi.has(p0[1]) || !yi.has(p1[1])) return null;
    const S = [xi.get(p0[0]), yi.get(p0[1])];
    const T = [xi.get(p1[0]), yi.get(p1[1])];
    const NX = xs.length, NY = ys.length;
    const D = [[1, 0], [-1, 0], [0, 1], [0, -1]];

    const key = (x, y, dx, dy) => ((y * NX + x) * 9) + ((dx + 1) * 3 + (dy + 1));
    const g = new Map(), prev = new Map();
    const start = key(S[0], S[1], 0, 0);
    g.set(start, 0);
    const pq = new Heap();
    pq.push(0, [S[0], S[1], 0, 0, start]);
    let goal = null;

    while (pq.size) {
      const [f, , st] = pq.pop();
      const [cx, cy, ddx, ddy, sk] = st;
      if (cx === T[0] && cy === T[1]) { goal = st; break; }
      const h0 = Math.abs(xs[T[0]] - xs[cx]) + Math.abs(ys[T[1]] - ys[cy]);
      if ((g.get(sk) ?? Infinity) + 1e-6 < f - h0) continue;
      for (const [dx, dy] of D) {
        const nx = cx + dx, ny = cy + dy;
        if (nx < 0 || nx >= NX || ny < 0 || ny >= NY) continue;
        const x1 = xs[cx], y1 = ys[cy], x2 = xs[nx], y2 = ys[ny];
        if (this.blocked(x1, y1, x2, y2, skip)) continue;
        let cost = Math.abs(x2 - x1) + Math.abs(y2 - y1);
        cost += this.segCost(dx, dy, x1, y1, x2, y2);
        if ((ddx !== 0 || ddy !== 0) && (dx !== ddx || dy !== ddy)) cost += bend;
        const nk = key(nx, ny, dx, dy);
        const ng = g.get(sk) + cost;
        if (ng < (g.get(nk) ?? Infinity) - 1e-9) {
          g.set(nk, ng);
          prev.set(nk, st);
          const h = Math.abs(xs[T[0]] - x2) + Math.abs(ys[T[1]] - y2);
          pq.push(ng + h, [nx, ny, dx, dy, nk]);
        }
      }
    }
    if (!goal) return null;
    const pts = [];
    let st = goal;
    while (prev.has(st[4])) { pts.push([xs[st[0]], ys[st[1]]]); st = prev.get(st[4]); }
    pts.push(p0);
    pts.reverse();
    return simplify(pts);
  }
}

/** 혼잡도 인식 라우터 */
export class OrthoC extends Ortho {
  constructor(rects, W, H, opt = {}) {
    super(rects, W, H, opt);
    this.lanesX = opt.lanesX || [];
    this.lanesY = opt.lanesY || [];
    this.tol = opt.tol ?? 7.0;
    this.congw = opt.cong ?? 90.0;
    this.used = new Map();
  }

  cong(axis, coord, lo, hi) {
    if (hi <= lo) return 0;
    let tot = 0;
    const b0 = Math.round(coord / this.tol);
    for (let b = b0 - 1; b <= b0 + 1; b++) {
      const list = this.used.get(axis + '|' + b);
      if (!list) continue;
      for (const [a0, a1, c] of list) {
        if (Math.abs(c - coord) > this.tol) continue;
        const ov = Math.min(hi, a1) - Math.max(lo, a0);
        if (ov > 0) tot += ov;
      }
    }
    return tot;
  }

  segCost(dx, dy, x1, y1, x2, y2) {
    if (dx === 0) return this.congw * this.cong('v', x1, Math.min(y1, y2), Math.max(y1, y2)) / 100;
    return this.congw * this.cong('h', y1, Math.min(x1, x2), Math.max(x1, x2)) / 100;
  }

  /** 배선된 경로를 혼잡도에 기록한다 */
  commit(pts) {
    for (let i = 0; i < pts.length - 1; i++) {
      const [x1, y1] = pts[i], [x2, y2] = pts[i + 1];
      const add = (axis, coord, lo, hi) => {
        const k = axis + '|' + Math.round(coord / this.tol);
        if (!this.used.has(k)) this.used.set(k, []);
        this.used.get(k).push([lo, hi, coord]);
      };
      if (Math.abs(x1 - x2) < 0.5 && Math.abs(y1 - y2) >= 0.5)
        add('v', x1, Math.min(y1, y2), Math.max(y1, y2));
      else if (Math.abs(y1 - y2) < 0.5 && Math.abs(x1 - x2) >= 0.5)
        add('h', y1, Math.min(x1, x2), Math.max(x1, x2));
    }
  }
}

/** 엣지마다 출발/도착 변과 포트 좌표를 배정한다.
 *  같은 변을 쓰는 엣지들은 상대편 위치 순으로 정렬해 변 위에 고르게 벌린다. */
export function ports(edges, rects, minGap = 13) {
  const sideOf = [];
  for (const [ai, bi] of edges) {
    const A = rects[ai], B = rects[bi];
    const acx = A.x + A.w / 2, acy = A.y + A.h / 2;
    const bcx = B.x + B.w / 2, bcy = B.y + B.h / 2;
    const dx = bcx - acx, dy = bcy - acy;
    const ox = Math.min(A.x + A.w, B.x + B.w) - Math.max(A.x, B.x);
    const oy = Math.min(A.y + A.h, B.y + B.h) - Math.max(A.y, B.y);
    let sa, sb;
    if (oy > 24 && Math.abs(dx) > 8) { sa = dx > 0 ? 'R' : 'L'; sb = dx > 0 ? 'L' : 'R'; }
    else if (ox > 24 && Math.abs(dy) > 8) { sa = dy > 0 ? 'B' : 'T'; sb = dy > 0 ? 'T' : 'B'; }
    else if (Math.abs(dx) >= Math.abs(dy)) { sa = dx > 0 ? 'R' : 'L'; sb = dx > 0 ? 'L' : 'R'; }
    else { sa = dy > 0 ? 'B' : 'T'; sb = dy > 0 ? 'T' : 'B'; }
    sideOf.push([sa, sb]);
  }

  const grp = new Map();
  edges.forEach(([ai, bi], k) => {
    const [sa, sb] = sideOf[k];
    const ka = ai + '|' + sa, kb = bi + '|' + sb;
    if (!grp.has(ka)) grp.set(ka, []);
    if (!grp.has(kb)) grp.set(kb, []);
    grp.get(ka).push([k, 'a']);
    grp.get(kb).push([k, 'b']);
  });

  const pos = new Map();
  for (const [gk, members] of grp) {
    const ni = +gk.split('|')[0], side = gk.split('|')[1];
    const R = rects[ni];
    const keyOf = ([k, end]) => {
      const oi = end === 'a' ? edges[k][1] : edges[k][0];
      const O = rects[oi];
      return (side === 'L' || side === 'R') ? O.y + O.h / 2 : O.x + O.w / 2;
    };
    members.sort((p, q) => keyOf(p) - keyOf(q));
    const n = members.length;
    const span = (side === 'L' || side === 'R') ? R.h : R.w;
    const usable = Math.max(span - 18, 8);
    const step = Math.min(minGap, usable / Math.max(n, 1));
    const base = (side === 'L' || side === 'R') ? R.y + R.h / 2 : R.x + R.w / 2;
    members.forEach((m, idx) => {
      const off = (idx - (n - 1) / 2) * step;
      let p;
      if (side === 'L') p = [R.x, base + off];
      else if (side === 'R') p = [R.x + R.w, base + off];
      else if (side === 'T') p = [base + off, R.y];
      else p = [base + off, R.y + R.h];
      pos.set(m[0] + '|' + m[1], p);
    });
  }
  return { sideOf, port: pos };
}

function laneOffsets(paths, gap, tol) {
  const buckets = new Map();
  paths.forEach((pts, pi) => {
    if (!pts || pts.length < 4) return;
    for (let i = 1; i < pts.length - 2; i++) {
      const [x1, y1] = pts[i], [x2, y2] = pts[i + 1];
      if (Math.abs(x1 - x2) < 0.5 && Math.abs(y1 - y2) >= 0.5) {
        const k = 'v|' + Math.round(x1 / tol);
        if (!buckets.has(k)) buckets.set(k, []);
        buckets.get(k).push([pi, i, Math.min(y1, y2), Math.max(y1, y2), 'v']);
      } else if (Math.abs(y1 - y2) < 0.5 && Math.abs(x1 - x2) >= 0.5) {
        const k = 'h|' + Math.round(y1 / tol);
        if (!buckets.has(k)) buckets.set(k, []);
        buckets.get(k).push([pi, i, Math.min(x1, x2), Math.max(x1, x2), 'h']);
      }
    }
  });
  const want = new Map();
  const bump = (pi, i, axis, v) => {
    const k = pi + '|' + i + '|' + axis;
    want.set(k, (want.get(k) || 0) + v);
  };
  for (const items of buckets.values()) {
    if (items.length < 2) continue;
    items.sort((a, b) => a[2] - b[2] || a[3] - b[3]);
    const laneEnd = [], assign = [];
    items.forEach(([, , lo, hi], k) => {
      let put = -1;
      for (let li = 0; li < laneEnd.length; li++) {
        if (lo >= laneEnd[li] - 0.5) { laneEnd[li] = hi; put = li; break; }
      }
      if (put < 0) { laneEnd.push(hi); put = laneEnd.length - 1; }
      assign[k] = put;
    });
    const n = laneEnd.length;
    if (n < 2) continue;
    items.forEach(([pi, i, , , axis], k) => {
      const off = (assign[k] - (n - 1) / 2) * gap;
      bump(pi, i, axis, off);
      bump(pi, i + 1, axis, off);
    });
  }
  return want;
}

/** 겹치는 평행선을 레인으로 벌린다.
 *  통째로 되돌리지 않고 경로별로 배율을 낮춰가며 안 뚫리는 최대치를 쓴다.
 *  분산은 라우팅 다음에 점을 옮기므로 관통 검사를 여기서 반드시 해야 한다. */
export function spread(paths, rects, skips, opt = {}) {
  const { gap = 9, tol = 6.0, rounds = 3, eps = 3.0, bounds = null } = opt;
  // 분산은 라우팅 다음에 점을 옮긴다. 범위 검사를 안 하면
  // 가장자리를 타던 선이 캔버스 밖으로 밀려나 잘려 보인다 — 실제로 그랬다.
  const inBounds = pts => !bounds || pts.every(([x, y]) =>
    x >= bounds.x1 - 0.5 && x <= bounds.x2 + 0.5 && y >= bounds.y1 - 0.5 && y <= bounds.y2 + 0.5);
  const scales = opt.scales || [1.0, 0.78, 0.56, 0.34, 0.16];
  let cur = paths.map(p => (p || []).map(q => [q[0], q[1]]));
  for (let r = 0; r < rounds; r++) {
    const want = laneOffsets(cur, gap, tol);
    cur = cur.map((pts, pi) => {
      if (!pts || pts.length < 4) return pts;
      for (const sc of scales) {
        const q = pts.map(p => [p[0], p[1]]);
        for (let j = 1; j < q.length - 1; j++) {
          const dv = (want.get(pi + '|' + j + '|v') || 0) * sc;
          const dh = (want.get(pi + '|' + j + '|h') || 0) * sc;
          if (dv) q[j][0] += dv;
          if (dh) q[j][1] += dh;
        }
        const cand = snap(q, eps);
        if (!pierces(cand, rects, skips[pi]) && inBounds(cand)) return cand;
      }
      return pts;
    });
  }
  return cur;
}
