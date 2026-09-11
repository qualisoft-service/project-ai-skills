/* 배치 — 열 순서 최적화 · 행 barycenter · 좌표 산출 */

export const GEO = {
  CW: 252, GUT: 164, CH: 66, CG: 48,
  HEAD: 44, TOP: 138, PAD: 60, FOOT: 96,
  // 열당 행 상한. 그룹 하나에 수십 개가 몰리면 캔버스가 좁고 길어지고
  // 그 형태에서 배선 탐색이 폭발한다 (75행 한 열에서 10분을 넘긴 적이 있다).
  // 넘치는 그룹은 같은 색의 이웃 열로 쪼갠다.
  MAX_ROWS: 14,
};

/** 시스템 배선(담당자·통화·감사)인가 — 업무 관계와 나눠 보기 위한 판정 */
export const SYS_TABLES = new Set(['systemuser', 'team', 'businessunit', 'organization',
  'transactioncurrency', 'uom', 'uomschedule', 'owner', 'queue', 'workflow', 'asyncoperation',
  'role', 'site', 'territory', 'position', 'mailbox', 'mobileofflineprofile', 'calendar',
  'resourcespec', 'constraintbasedgroup', 'equipment', 'solution', 'plugintracelog', 'syncerror',
  'msdyn_postconfig', 'msdyn_postruleconfig']);

export const SYS_COLS = new Set(['createdby', 'modifiedby', 'createdonbehalfby',
  'modifiedonbehalfby', 'owninguser', 'owningteam', 'owningbusinessunit', 'ownerid',
  'transactioncurrencyid']);

export const isSys = r => SYS_TABLES.has(r.to) || SYS_COLS.has(r.col);

/** 도메인 사이 참조 거리 합이 최소가 되도록 열 순서를 고른다 (탐욕 + 국소 교환) */
export function orderColumns(domains, refs, groupOf) {
  const pair = new Map();
  for (const r of refs) {
    const ga = groupOf.get(r.from), gb = groupOf.get(r.to);
    if (!ga || !gb || ga === gb) continue;
    // 그룹명에 공백이 있을 수 있어 공백으로 나눌 수 없다.
    // 소스에 날 제어문자를 두면 파일이 바이너리로 취급되고
    // 브라우저 인라인 시 U+FFFD 로 바뀔 수 있어 이스케이프로 쓴다.
    const k = [ga, gb].sort().join('\u001f');
    pair.set(k, (pair.get(k) || 0) + 1);
  }
  const pairs = [...pair].map(([k, n]) => {
    const [x, y] = k.split('\u001f');
    return { x, y, n };
  });
  const cost = ord => {
    const ix = new Map(ord.map((d, i) => [d, i]));
    let s = 0;
    for (const p of pairs) s += p.n * Math.abs(ix.get(p.x) - ix.get(p.y));
    return s;
  };
  const deg = d => pairs.reduce((s, p) => s + ((p.x === d || p.y === d) ? p.n : 0), 0);

  let ord = [...domains].sort((a, b) => deg(b) - deg(a));
  let best = cost(ord), improved = true;
  while (improved) {
    improved = false;
    for (let i = 0; i < ord.length; i++) {
      for (let j = i + 1; j < ord.length; j++) {
        const o = ord.slice();
        [o[i], o[j]] = [o[j], o[i]];
        const c = cost(o);
        if (c < best) { ord = o; best = c; improved = true; }
      }
    }
  }
  return { order: ord, cost: best };
}

export function layout(model, opt = {}) {
  const g = { ...GEO, ...(opt.geo || {}) };
  const { tables, groups, groupOf, refs } = model;
  const fallback = groups.length ? groups[groups.length - 1].name : 'etc';
  const domains = groups.map(x => x.name);

  const { order, cost } = orderColumns(domains, refs, groupOf);

  const inb = new Map();
  for (const r of refs) inb.set(r.to, (inb.get(r.to) || 0) + 1);
  const IN = t => inb.get(t) || 0;

  const cols = new Map(order.map(d => [d, []]));
  for (const t of tables.keys()) {
    const d = groupOf.get(t) || fallback;
    if (!cols.has(d)) { cols.set(d, []); order.push(d); }
    cols.get(d).push(t);
  }
  for (const d of order) {
    cols.get(d).sort((a, b) =>
      IN(b) - IN(a) ||
      tables.get(b).total - tables.get(a).total ||
      (a < b ? -1 : 1));
  }

  // 행 barycenter — 이웃의 평균 행에 가깝게. 교차가 줄어든다.
  const row = new Map();
  order.forEach(d => cols.get(d).forEach((t, j) => row.set(t, j)));

  const adj = new Map();
  const push = (k, v) => { if (!adj.has(k)) adj.set(k, []); adj.get(k).push(v); };
  for (const r of refs) { push(r.from, r.to); push(r.to, r.from); }

  for (let it = 0; it < 14; it++) {
    for (const d of order) {
      const mem = cols.get(d);
      if (mem.length < 2) continue;
      const key = new Map();
      for (const t of mem) {
        const ns = (adj.get(t) || [])
          .filter(o => row.has(o) && groupOf.get(o) !== d)
          .map(o => row.get(o));
        key.set(t, ns.length ? ns.reduce((a, b) => a + b, 0) / ns.length : row.get(t));
      }
      mem.sort((a, b) => key.get(a) - key.get(b) || IN(b) - IN(a));
      mem.forEach((t, j) => row.set(t, j));
    }
  }

  // 큰 그룹을 이웃 열로 쪼갠다. 같은 그룹이므로 색과 번들은 그대로 묶인다.
  const cap = Math.max(4, g.MAX_ROWS);
  const columns = [];
  for (const d of order) {
    const mem = cols.get(d);
    if (!mem.length) continue;
    const parts = Math.ceil(mem.length / cap);
    const per = Math.ceil(mem.length / parts);
    for (let p = 0; p < parts; p++) {
      const slice = mem.slice(p * per, (p + 1) * per);
      if (slice.length) columns.push({ dom: d, members: slice, part: p + 1, parts });
    }
  }

  const pos = new Map();
  columns.forEach((c, ci) => {
    c.x = g.PAD + ci * (g.CW + g.GUT);
    c.members.forEach((t, j) => pos.set(t, {
      x: c.x,
      y: g.TOP + g.HEAD + j * (g.CH + g.CG),
      w: g.CW, h: g.CH,
      dom: c.dom, col: ci, row: j,
    }));
  });

  const maxRows = Math.max(...columns.map(c => c.members.length));
  const W = g.PAD + columns.length * (g.CW + g.GUT) + 20;
  const H = g.TOP + g.HEAD + maxRows * (g.CH + g.CG) + g.FOOT;

  // 열마다 하나 — 머리말을 붙이는 단위
  const domRects = columns.map(c => {
    const ys = c.members.map(t => pos.get(t).y);
    return {
      dom: c.dom, x: c.x, y: Math.min(...ys) - 14, w: g.CW,
      h: Math.max(...ys) + g.CH - Math.min(...ys) + 28,
      count: c.members.length,
      label: c.parts > 1 ? c.dom + ' ' + c.part + '/' + c.parts : c.dom,
    };
  });

  // 도메인마다 하나 — 번들이 붙는 단위 (쪼갠 열들을 감싼다)
  const domBounds = [];
  for (const d of order) {
    const rs = domRects.filter(r => r.dom === d);
    if (!rs.length) continue;
    const x1 = Math.min(...rs.map(r => r.x)), x2 = Math.max(...rs.map(r => r.x + r.w));
    const y1 = Math.min(...rs.map(r => r.y)), y2 = Math.max(...rs.map(r => r.y + r.h));
    domBounds.push({ dom: d, x: x1, y: y1, w: x2 - x1, h: y2 - y1, count: cols.get(d).length });
  }

  return { order, cols, columns, pos, domRects, domBounds, W, H, geo: g, colCost: cost, maxRows };
}
