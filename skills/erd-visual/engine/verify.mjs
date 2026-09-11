/* 검증 — 관통 · 겹침 · 텍스트 넘침
 *
 * 이 프로젝트에서 눈으로 못 본 결함을 전부 여기서 잡았다.
 * 검사를 배선 '전에' 돌리면 통과한 것처럼 보인다 (채널 분산이 점을 옮기기 때문).
 * 반드시 최종 경로로 판정한다.
 */

import { pierces } from './router.mjs';

/** 한글은 1em, 라틴은 0.56em 로 본 대략적인 렌더 폭.
 *  정확한 값은 브라우저만 안다 — verify.html 이 getBBox 로 다시 잰다. */
export function textWidth(s, px, ko = 1.0, asc = 0.56) {
  let w = 0;
  for (const ch of s) w += px * (ch.codePointAt(0) > 0x2000 ? ko : asc);
  return w;
}

/** 폭에 맞게 자른다. 글자수로 자르면 한글/영문이 제각각 깨진다. */
export function fitText(s, maxPx, px, ko = 1.0, asc = 0.56) {
  if (textWidth(s, px, ko, asc) <= maxPx) return s;
  const ell = textWidth('…', px, ko, asc);
  let out = '';
  for (const ch of s) {
    if (textWidth(out + ch, px, ko, asc) + ell > maxPx) break;
    out += ch;
  }
  return out ? out.replace(/\s+$/, '') + '…' : '…';
}

function segments(paths) {
  const out = [];
  paths.forEach((pts, pi) => {
    if (!pts) return;
    for (let i = 0; i < pts.length - 1; i++) {
      const [x1, y1] = pts[i], [x2, y2] = pts[i + 1];
      if (Math.abs(x1 - x2) < 0.5 && Math.abs(y1 - y2) >= 0.5)
        out.push([pi, 'v', x1, Math.min(y1, y2), Math.max(y1, y2)]);
      else if (Math.abs(y1 - y2) < 0.5 && Math.abs(x1 - x2) >= 0.5)
        out.push([pi, 'h', y1, Math.min(x1, x2), Math.max(x1, x2)]);
    }
  });
  return out;
}

/** 같은 축·같은 좌표에서 실제로 겹쳐 보이는 구간 쌍을 센다 */
export function measureOverlap(paths, tol = 2.0, minLen = 12.0) {
  const S = segments(paths);
  const buck = new Map();
  for (const s of S) {
    const k = s[1] + '|' + Math.round(s[2] / tol);
    if (!buck.has(k)) buck.set(k, []);
    buck.get(k).push(s);
  }
  let pairs = 0, total = 0;
  for (const v of buck.values()) {
    for (let i = 0; i < v.length; i++) {
      for (let j = i + 1; j < v.length; j++) {
        const a = v[i], b = v[j];
        if (a[0] === b[0]) continue;
        if (Math.abs(a[2] - b[2]) > tol) continue;
        const ov = Math.min(a[4], b[4]) - Math.max(a[3], b[3]);
        if (ov > minLen) { pairs++; total += ov; }
      }
    }
  }
  return { segments: S.length, overlapPairs: pairs, overlapLen: Math.round(total) };
}

/** 배선이 카드를 뚫는가 */
export function checkPierce(paths, rects, skips) {
  const bad = [];
  paths.forEach((pts, i) => {
    if (pts && pierces(pts, rects, skips[i], 1.5)) bad.push(i);
  });
  return bad;
}

/** 카드끼리 겹치는가 */
export function checkCardOverlap(rects, names = []) {
  const bad = [];
  for (let i = 0; i < rects.length; i++) {
    for (let j = i + 1; j < rects.length; j++) {
      const a = rects[i], b = rects[j];
      if (a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y)
        bad.push([names[i] || i, names[j] || j]);
    }
  }
  return bad;
}

/** 카드 안 텍스트가 카드 밖으로 나가는가 (추정 폭 기준) */
export function checkTextFit(items) {
  const bad = [];
  for (const it of items) {
    const w = textWidth(it.text, it.px, it.ko ?? 1.0, it.asc ?? 0.56);
    if (w > it.maxPx + 0.5) bad.push({ ...it, width: Math.round(w), over: Math.round(w - it.maxPx) });
  }
  return bad;
}

/** 캔버스를 벗어나는 좌표가 있는가 */
export function checkBounds(rects, W, H) {
  return rects.filter(r => r.x < 0 || r.y < 0 || r.x + r.w > W || r.y + r.h > H);
}

/** 배선이 캔버스를 벗어나는가.
 *  카드만 검사하면 놓친다 — 굵은 번들이 가장자리를 타다 밀려 나간 적이 있다. */
export function checkPathBounds(paths, W, H, pad = 0) {
  const bad = [];
  paths.forEach((pts, i) => {
    if (!pts) return;
    for (const [x, y] of pts) {
      if (x < -pad || y < -pad || x > W + pad || y > H + pad) {
        bad.push({ i, at: [Math.round(x), Math.round(y)] });
        break;
      }
    }
  });
  return bad;
}

/** 전체 판정 — 필수 항목이 하나라도 0 이 아니면 실패 */
export function report(res) {
  const must = [
    ['카드 관통', res.pierce.length],
    ['카드 겹침', res.cardOverlap.length],
    ['텍스트 넘침', res.textFit.length],
    ['캔버스 이탈', res.bounds.length + (res.pathBounds ? res.pathBounds.length : 0)
      + (res.bundleBounds ? res.bundleBounds.length : 0)],
  ];
  const failed = must.filter(([, n]) => n > 0);
  return {
    ok: failed.length === 0,
    must,
    failed,
    overlap: res.overlap,
  };
}
