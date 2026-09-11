/* 렌더 — 골조는 흑백, 카드만 파스텔
 *
 * 배선에서 색을 뺀 것이 핵심이다. 200개 선이 도메인별 색으로 갈리면
 * 카드 색과 경쟁해서 어느 쪽도 안 읽힌다. 선은 무채색, 색은 카드에만.
 */

import { rounded } from './router.mjs';
import { fitText } from './verify.mjs';

export const INK = '#09090B';
export const INK_2 = '#52525B';
export const INK_3 = '#A1A1AA';
export const LINE = '#E4E4E7';
export const PAPER = '#FFFFFF';
export const PAPER_2 = '#FAFAFA';
export const WIRE = '#18181B';

/** 파스텔 팔레트 — 그룹 이름이 아니라 순서로 배정한다.
 *  어떤 DBML 이 와도 동작해야 하므로 도메인명을 박아두지 않는다. */
export const PASTEL = [
  ['#FFEAD7', '#B4703C'], ['#DEF2E3', '#3F7A52'], ['#FBF1D5', '#9C8233'],
  ['#E9E3FB', '#6A5CA6'], ['#DEEBF9', '#3F6D9B'], ['#FBE1E1', '#A45454'],
  ['#DBF1F3', '#3F7F87'], ['#FBE1EC', '#9E4F73'], ['#DFF2EA', '#3F8069'],
  ['#F3E8D6', '#8A6E43'], ['#E6E9F7', '#5A6296'], ['#F0E7F5', '#7A5E88'],
  ['#EBEBED', '#5C5C64'], ['#F1F1F2', '#6E6E76'], ['#F6F6F7', '#83838B'],
  ['#E4E4E7', '#4A4A51'],
];

export function palette(order) {
  const m = new Map();
  order.forEach((d, i) => m.set(d, PASTEL[i % PASTEL.length]));
  return m;
}

export const esc = s => String(s ?? '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

/** 그룹 이름을 헤더용으로 줄인다 */
const shortName = d => d.length > 12 ? d.slice(0, 11) + '…' : d;

export function renderDetail(model, lay, wiring, opt = {}) {
  const { paths, bundlePaths, bundleKeys, bundleCount, isSysRef } = wiring;
  const P = [];
  const A = s => P.push(s);
  const COL = opt.palette || palette(lay.order);
  const title = opt.title || 'ERD';
  const W = lay.W, H = lay.H, g = lay.geo;
  const names = [...lay.pos.keys()];

  A('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ' + W + ' ' + H + '" id="detail" ' +
    'font-family="Pretendard, -apple-system, \'Apple SD Gothic Neo\', sans-serif">');
  A('<defs>' +
    '<marker id="d-ah" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="5" markerHeight="5" ' +
    'orient="auto-start-reverse"><path d="M0,.9 L7.2,4 L0,7.1 z" fill="' + WIRE + '"/></marker>' +
    '<marker id="b-ah" viewBox="0 0 10 10" refX="8.5" refY="5" markerWidth="5.6" markerHeight="5.6" ' +
    'orient="auto-start-reverse"><path d="M0,1 L9,5 L0,9 z" fill="' + WIRE + '"/></marker></defs>');
  A('<rect width="' + W + '" height="' + H + '" fill="' + PAPER + '"/>');
  A('<text x="60" y="60" font-size="30" font-weight="800" fill="' + INK + '" letter-spacing="-.02em">' +
    esc(title) + '</text>');
  A('<text x="60" y="90" font-size="14" fill="' + INK_2 + '">' + esc(opt.subtitle || '') + '</text>');
  A('<line x1="60" y1="112" x2="' + (W - 60) + '" y2="112" stroke="' + INK + '" stroke-width="1.6"/>');

  // 도메인 구획 — 흑백 헤더 + 파스텔 점
  for (const r of lay.domRects) {
    const [bg] = COL.get(r.dom);
    A('<rect x="' + (r.x - 16) + '" y="' + (r.y - 46) + '" width="' + (r.w + 32) + '" height="' + (r.h + 58) +
      '" rx="14" fill="' + PAPER_2 + '" stroke="' + LINE + '" stroke-width="1.4"/>');
    A('<rect x="' + (r.x - 16) + '" y="' + (r.y - 46) + '" width="' + (r.w + 32) + '" height="30" rx="14" fill="' + INK + '"/>');
    A('<rect x="' + (r.x - 16) + '" y="' + (r.y - 30) + '" width="' + (r.w + 32) + '" height="14" fill="' + INK + '"/>');
    A('<circle cx="' + (r.x + 2) + '" cy="' + (r.y - 31) + '" r="5" fill="' + bg + '"/>');
    A('<text x="' + (r.x + 16) + '" y="' + (r.y - 26) + '" font-size="13.5" font-weight="700" fill="' + PAPER + '">' +
      esc(shortName(r.label || r.dom)) + '</text>');
    A('<text x="' + (r.x + r.w - 16) + '" y="' + (r.y - 26) + '" font-size="12.5" font-weight="600" fill="' +
      INK_3 + '" text-anchor="end">' + r.count + '</text>');
  }

  // 도메인 번들 — 굵기 = 참조 수
  A('<g id="bundles" fill="none" stroke-linejoin="round" stroke-linecap="round">');
  bundlePaths.forEach((pts, k) => {
    const [ga, gb] = bundleKeys[k];
    const n = bundleCount[k];
    A('<path class="bd" d="' + rounded(pts, 12) + '" stroke="' + WIRE + '" stroke-width="' +
      (1.4 + Math.min(n, 11) * 0.56).toFixed(1) + '" opacity=".42" marker-end="url(#b-ah)">' +
      '<title>' + esc(shortName(ga)) + ' → ' + esc(shortName(gb)) + ' · 외래키 ' + n + '건</title></path>');
  });
  A('</g>');

  // 개별 배선 — 무채색
  A('<g id="edges" fill="none" stroke-linejoin="round" stroke-linecap="round">');
  model.refs.forEach((r, k) => {
    const sys = isSysRef[k];
    A('<path class="ed ' + (sys ? 'sys' : 'biz') + '" data-a="' + esc(r.from) + '" data-b="' + esc(r.to) +
      '" d="' + rounded(paths[k], 8) + '" stroke="' + WIRE + '" stroke-width="1.15" opacity="' +
      (sys ? 0.13 : 0.3) + '" marker-end="url(#d-ah)"><title>' +
      esc(r.from) + '.' + esc(r.col) + ' → ' + esc(r.to) + '</title></path>');
  });
  A('</g>');

  // 카드 — 파스텔 + 굵은 흑색 글자
  A('<g id="cards">');
  const INNER = g.CW - 30;
  for (const t of names) {
    const p = lay.pos.get(t), m = model.tables.get(t);
    const [bg, ac] = COL.get(p.dom);
    A('<g class="cd" data-t="' + esc(t) + '"><title>' + esc(m.label) + ' · ' + esc(t) + '</title>');
    A('<rect class="hit" x="' + (p.x - 3) + '" y="' + (p.y - 3) + '" width="' + (p.w + 6) +
      '" height="' + (p.h + 6) + '" rx="12" fill="transparent"/>');
    A('<rect class="bd0" x="' + p.x + '" y="' + p.y + '" width="' + p.w + '" height="' + p.h +
      '" rx="10" fill="' + (m.stub ? PAPER : bg) + '" stroke="' + INK + '" stroke-width="1.5"' +
      (m.stub ? ' stroke-dasharray="5 4"' : '') + '/>');
    A('<rect x="' + p.x + '" y="' + (p.y + 10) + '" width="5" height="' + (p.h - 20) +
      '" rx="2.5" fill="' + ac + '"/>');
    A('<text x="' + (p.x + 18) + '" y="' + (p.y + 27) + '" font-size="15.5" font-weight="800" fill="' +
      INK + '" letter-spacing="-.01em">' + esc(fitText(m.label, INNER, 15.5)) + '</text>');
    A('<text x="' + (p.x + 18) + '" y="' + (p.y + 48) + '" font-size="11" font-weight="600" fill="' +
      INK_2 + '" font-family="ui-monospace, Menlo, monospace">' +
      esc(fitText(t, INNER - 26, 11, 1.0, 0.62)) + '</text>');
    if (m.total)
      A('<text x="' + (p.x + p.w - 12) + '" y="' + (p.y + 48) + '" font-size="10.5" font-weight="600" fill="' +
        INK_3 + '" text-anchor="end" font-family="ui-monospace, Menlo, monospace">' + m.total + '</text>');
    if (m.custom)
      A('<circle cx="' + (p.x + p.w - 13) + '" cy="' + (p.y + 17) + '" r="3.6" fill="' + INK + '"/>');
    A('</g>');
  }
  A('</g>');

  // 범례
  const y = H - 40;
  A('<line x1="60" y1="' + (y - 30) + '" x2="' + (W - 60) + '" y2="' + (y - 30) +
    '" stroke="' + LINE + '" stroke-width="1.2"/>');
  A('<g transform="translate(60,' + y + ')" font-size="12.5" fill="' + INK_2 + '">');
  A('<circle cx="5" cy="-5" r="3.6" fill="' + INK + '"/><text x="18" y="0">커스텀 테이블</text>');
  A('<rect x="150" y="-14" width="24" height="16" rx="5" fill="' + PAPER + '" stroke="' + INK +
    '" stroke-width="1.5" stroke-dasharray="5 4"/><text x="184" y="0">참조되나 정의 없음</text>');
  A('<path d="M400,-5 L426,-5 L426,-13 L452,-13" fill="none" stroke="' + WIRE +
    '" stroke-width="2.4" stroke-linejoin="round" opacity=".5"/>' +
    '<text x="464" y="0">실제 외래키 · 번들 굵기 = 참조 수</text>');
  A('<text x="800" y="0">우측 숫자 = 총 속성</text>');
  A('<rect x="960" y="-13" width="14" height="14" rx="4" fill="#DEEBF9" stroke="' + INK +
    '" stroke-width="1.2"/><text x="984" y="0">카드 색 = 그룹</text>');
  A('</g></svg>');
  return P.join('\n');
}
