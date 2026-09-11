/* CSV 판독기 — xlsx 와 같은 원칙.
 * CSV 에도 외래키 개념이 없다. 매핑이 없으면 구조만 보고한다.
 */

import { emptyIR } from './index.mjs';
import { applyMap } from './xlsx.mjs';

/** RFC4180 — 따옴표 안의 구분자·줄바꿈을 지킨다 */
export function parseCsv(text, delim) {
  const src = text.replace(/^\uFEFF/, '');
  if (!delim) {
    const head = src.slice(0, 4000);
    const counts = [[',', 0], [';', 0], ['\t', 0], ['|', 0]]
      .map(([d]) => [d, (head.match(new RegExp('\\' + d, 'g')) || []).length]);
    counts.sort((a, b) => b[1] - a[1]);
    delim = counts[0][1] ? counts[0][0] : ',';
  }
  const rows = [];
  let row = [], cur = '', q = false;
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (q) {
      if (c === '"') {
        if (src[i + 1] === '"') { cur += '"'; i++; }
        else q = false;
      } else cur += c;
      continue;
    }
    if (c === '"') { q = true; continue; }
    if (c === delim) { row.push(cur); cur = ''; continue; }
    if (c === '\r') continue;
    if (c === '\n') { row.push(cur); rows.push(row); row = []; cur = ''; continue; }
    cur += c;
  }
  if (cur !== '' || row.length) { row.push(cur); rows.push(row); }
  return { rows: rows.filter(r => r.some(v => String(v).trim() !== '')), delim };
}

/** 0-based 인덱스를 스프레드시트 열 이름으로 (0 -> A, 26 -> AA) */
export function colName(i) {
  let s = '';
  i += 1;
  while (i > 0) { const r = (i - 1) % 26; s = String.fromCharCode(65 + r) + s; i = Math.floor((i - 1) / 26); }
  return s;
}

export function readCsv(text, source = 'input.csv', opt = {}) {
  const ir = emptyIR(source, 'csv');
  const { rows, delim } = parseCsv(text, opt.delim);
  if (!rows.length) { ir.warnings.push('빈 파일입니다'); return ir; }

  // xlsx 와 같은 { A: '값' } 형태로 맞춰 매핑 로직을 공유한다
  const asObj = rows.map(r => {
    const o = {};
    r.forEach((v, i) => { o[colName(i)] = String(v).trim(); });
    return o;
  });
  const header = asObj[0];
  const sheet = {
    name: source.replace(/\.[^.]+$/, ''),
    rows: asObj.length,
    dataRows: asObj.length - 1,
    columns: Object.keys(header)
      .sort((a, b) => a.length - b.length || (a < b ? -1 : 1))
      .map(c => ({ col: c, header: header[c] || '' })),
    sample: asObj.slice(1, 4),
    all: asObj,
    delim,
  };
  ir.sheets = [sheet];

  if (!opt.map) {
    ir.needsMapping = true;
    ir.warnings.push('CSV 에는 외래키 정보가 없습니다. 매핑을 줘야 테이블·관계를 뽑습니다 '
      + '(구분자 "' + (delim === '\t' ? 'TAB' : delim) + '" · 데이터 ' + sheet.dataRows + '행 · 열 '
      + sheet.columns.length + '개)');
    return ir;
  }
  applyMap(ir, [sheet], opt.map);
  return ir;
}
