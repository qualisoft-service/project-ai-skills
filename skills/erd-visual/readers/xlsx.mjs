/* xlsx 판독기 — zip + XML.
 *
 * 중요: 엑셀에는 외래키 개념이 없다. 어느 열이 관계 근거인지는 자료마다 다르다.
 * 그래서 이 판독기는 **시트를 읽어 구조를 보고할 뿐** 스스로 스키마를 만들지 않는다.
 * 매핑(--map)이 주어졌을 때만 테이블·관계를 뽑는다.
 * 이걸 자동으로 추측하게 만들면 그럴듯한 거짓 ERD 가 조용히 나온다.
 */

import { unzip } from './zip.mjs';
import { emptyIR } from './index.mjs';

const ENT = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
export const unesc = s => String(s).replace(/&(#x?[0-9a-fA-F]+|\w+);/g, (m, e) => {
  if (e[0] === '#') return String.fromCodePoint(e[1] === 'x' || e[1] === 'X'
    ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10));
  return ENT[e] ?? m;
});

/** <t>…</t> 안의 글자를 모두 모은다 (리치 텍스트는 run 으로 쪼개져 있다) */
function joinT(xml) {
  let out = '';
  const re = /<t\b[^>]*>([\s\S]*?)<\/t>|<t\b[^>]*\/>/g;
  let m;
  while ((m = re.exec(xml))) out += m[1] ? unesc(m[1]) : '';
  return out;
}

function sharedStrings(zip) {
  if (!zip.has('xl/sharedStrings.xml')) return [];
  const xml = zip.text('xl/sharedStrings.xml');
  const out = [];
  const re = /<si\b[^>]*>([\s\S]*?)<\/si>|<si\b[^>]*\/>/g;
  let m;
  while ((m = re.exec(xml))) out.push(m[1] ? joinT(m[1]) : '');
  return out;
}

function sheetTargets(zip) {
  const wb = zip.text('xl/workbook.xml');
  const rels = zip.has('xl/_rels/workbook.xml.rels') ? zip.text('xl/_rels/workbook.xml.rels') : '';
  const rmap = new Map();
  let m;
  const reRel = /<Relationship\b[^>]*Id="([^"]+)"[^>]*Target="([^"]+)"[^>]*\/?>/g;
  while ((m = reRel.exec(rels))) rmap.set(m[1], m[2]);

  const out = [];
  const reSheet = /<sheet\b[^>]*\/?>/g;
  while ((m = reSheet.exec(wb))) {
    const tag = m[0];
    const name = (tag.match(/name="([^"]*)"/) || [, ''])[1];
    const rid = (tag.match(/r:id="([^"]*)"/) || [, ''])[1];
    let target = rmap.get(rid) || '';
    if (!target) continue;
    target = target.replace(/^\//, '');
    if (!target.startsWith('xl/')) target = 'xl/' + target.replace(/^\.\//, '');
    out.push({ name: unesc(name), path: target });
  }
  return out;
}

const colOf = ref => (String(ref).match(/^([A-Z]+)/) || [, ''])[1];

/** 시트를 행 배열로. 각 행은 { A: '값', B: '값' } */
export function readSheet(zip, sheetPath, ss, limit = Infinity) {
  const xml = zip.text(sheetPath);
  const rows = [];
  const reRow = /<row\b[^>]*>([\s\S]*?)<\/row>|<row\b[^>]*\/>/g;
  let m;
  while ((m = reRow.exec(xml)) && rows.length < limit) {
    const body = m[1] || '';
    const cells = {};
    const reCell = /<c\b([^>]*)(?:\/>|>([\s\S]*?)<\/c>)/g;
    let c;
    while ((c = reCell.exec(body))) {
      const attrs = c[1], inner = c[2] || '';
      const ref = (attrs.match(/r="([A-Z]+\d+)"/) || [, ''])[1];
      if (!ref) continue;
      const t = (attrs.match(/t="([^"]*)"/) || [, ''])[1];
      let val = '';
      if (t === 's') {
        const v = inner.match(/<v>([\s\S]*?)<\/v>/);
        if (v) val = ss[+v[1]] ?? '';
      } else if (t === 'inlineStr') {
        val = joinT(inner);
      } else if (t === 'str') {
        const v = inner.match(/<v>([\s\S]*?)<\/v>/);
        val = v ? unesc(v[1]) : '';
      } else {
        const v = inner.match(/<v>([\s\S]*?)<\/v>/);
        val = v ? unesc(v[1]) : '';
      }
      cells[colOf(ref)] = String(val).trim();
    }
    rows.push(cells);
  }
  return rows;
}

/**
 * @param buf  파일 버퍼
 * @param source 표시용 이름
 * @param opt  { map } — 매핑이 없으면 구조만 보고한다
 */
export function readXlsx(buf, source = 'input.xlsx', opt = {}) {
  const ir = emptyIR(source, 'xlsx');
  let zip;
  try { zip = unzip(buf); }
  catch (e) { ir.warnings.push('열 수 없습니다: ' + e.message); return ir; }

  const ss = sharedStrings(zip);
  const sheets = [];
  for (const s of sheetTargets(zip)) {
    if (!zip.has(s.path)) { ir.warnings.push('시트 파일 없음: ' + s.path); continue; }
    const rows = readSheet(zip, s.path, ss);
    const header = rows.length ? rows[0] : {};
    const cols = Object.keys(header).sort((a, b) => a.length - b.length || (a < b ? -1 : 1));
    sheets.push({
      name: s.name,
      rows: rows.length,
      dataRows: Math.max(0, rows.length - 1),
      columns: cols.map(c => ({ col: c, header: header[c] || '' })),
      sample: rows.slice(1, 4),
      all: rows,
    });
  }
  ir.sheets = sheets;

  if (!opt.map) {
    ir.needsMapping = true;
    ir.warnings.push('엑셀에는 외래키 정보가 없습니다. 어느 열이 무엇인지 정해줘야 테이블·관계를 뽑습니다 '
      + '(시트 ' + sheets.length + '개: ' + sheets.map(s => s.name + ' ' + s.dataRows + '행').join(', ') + ')');
    return ir;
  }

  applyMap(ir, sheets, opt.map);
  return ir;
}

/**
 * 매핑 규격 (map.json)
 * {
 *   "entities": { "sheet":"Entities list", "name":"E", "label":"A", "group":"H" },
 *   "attributes": {
 *     "sheet":"Metadata", "table":"B", "name":"C", "type":"F", "label":"E",
 *     "required":"J", "extra":"L",
 *     "refPattern":"Targets:\\s*(.*)"      // extra 열에서 대상 엔티티를 뽑는 정규식
 *   }
 * }
 */
export function applyMap(ir, sheets, map) {
  const find = n => sheets.find(s => s.name === n);
  const get = (row, col) => (col && row[col] != null ? String(row[col]).trim() : '');
  const clean = s => s.replace(/_x000D_/g, '').replace(/\r/g, '').trim();

  const tables = new Map();

  if (map.entities) {
    const sh = find(map.entities.sheet);
    if (!sh) { ir.warnings.push('시트를 찾지 못함: ' + map.entities.sheet); return ir; }
    for (const row of sh.all.slice(1)) {
      const name = get(row, map.entities.name);
      if (!name) continue;
      tables.set(name, {
        name,
        label: get(row, map.entities.label) || name,
        group: get(row, map.entities.group) || null,
        columns: [],
      });
    }
  }

  if (map.attributes) {
    const sh = find(map.attributes.sheet);
    if (!sh) { ir.warnings.push('시트를 찾지 못함: ' + map.attributes.sheet); return ir; }
    const A = map.attributes;
    const reRef = A.refPattern ? new RegExp(A.refPattern, 's') : null;

    for (const row of sh.all.slice(1)) {
      const tname = get(row, A.table);
      const cname = get(row, A.name);
      if (!tname || !cname) continue;
      if (!tables.has(tname)) {
        tables.set(tname, { name: tname, label: tname, group: null, columns: [] });
      }
      const t = tables.get(tname);
      const req = get(row, A.required);
      const col = {
        name: cname,
        type: get(row, A.type) || 'unknown',
        pk: false,
        notNull: /Required/i.test(req),
        note: get(row, A.label) || cname,
      };
      t.columns.push(col);

      if (!reRef) continue;
      const extra = clean(get(row, A.extra));
      const m = extra.match(reRef);
      if (!m) continue;
      const targets = m[1].split('\n').map(x => x.trim()).filter(Boolean);
      if (targets.length === 1) {
        ir.refs.push({
          from: tname, col: cname, to: targets[0], toCol: null,
          evidence: A.extra + ': ' + extra.slice(0, 120),
          confidence: 'fact',
        });
      } else if (targets.length > 1) {
        // 다형 참조 — 하나를 고르면 없는 사실을 만드는 것이다. 선을 긋지 않는다.
        col.note += ' → 다형: ' + (targets.length <= 4 ? targets.join(', ')
          : targets.slice(0, 4).join(', ') + ' 외 ' + (targets.length - 4));
        ir.polymorphic = (ir.polymorphic || 0) + 1;
      }
    }
  }

  ir.tables = [...tables.values()];
  if (ir.polymorphic)
    ir.warnings.push('다형 참조 ' + ir.polymorphic + '건은 Ref 로 그리지 않고 컬럼 note 에만 적었습니다');
  return ir;
}
