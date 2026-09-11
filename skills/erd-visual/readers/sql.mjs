/* DDL SQL 판독기 — CREATE TABLE + FOREIGN KEY
 *
 * 관계 근거가 제약조건에 명시돼 있으므로 이 형식은 전부 confidence:'fact' 다.
 * 추측이 끼어들 자리가 없다. 그래서 가장 먼저 만들었다.
 *
 * 읽는 것: CREATE TABLE (인라인 REFERENCES · 테이블 레벨 FOREIGN KEY · PRIMARY KEY),
 *          ALTER TABLE ADD CONSTRAINT FOREIGN KEY, COMMENT ON.
 * 못 읽은 문장은 버리지 않고 unparsed 에 남긴다.
 */

import { emptyIR } from './index.mjs';

/** 문자열 리터럴을 지키면서 주석만 제거한다 */
function stripComments(src) {
  let out = '', i = 0, n = src.length;
  while (i < n) {
    const c = src[i], d = src[i + 1];
    if (c === "'" || c === '"' || c === '`') {
      const q = c;
      out += c; i++;
      while (i < n) {
        out += src[i];
        if (src[i] === q && src[i - 1] !== '\\') { i++; break; }
        i++;
      }
      continue;
    }
    if (c === '-' && d === '-') { while (i < n && src[i] !== '\n') i++; continue; }
    if (c === '/' && d === '*') { i += 2; while (i < n && !(src[i] === '*' && src[i + 1] === '/')) i++; i += 2; continue; }
    out += c; i++;
  }
  return out;
}

const unquote = s => (s || '').trim()
  .replace(/^[`"\[]/, '').replace(/[`"\]]$/, '');

/** schema.table -> {schema, table} */
function splitName(raw) {
  const parts = String(raw).trim().split('.').map(unquote).filter(Boolean);
  if (parts.length >= 2) return { schema: parts[parts.length - 2], table: parts[parts.length - 1] };
  return { schema: null, table: parts[0] || '' };
}

/** 여는 괄호 위치에서 짝이 맞는 닫는 괄호를 찾는다 (문자열 무시) */
function matchParen(src, open) {
  let depth = 0;
  for (let i = open; i < src.length; i++) {
    const c = src[i];
    if (c === "'" || c === '"' || c === '`') {
      const q = c; i++;
      while (i < src.length && !(src[i] === q && src[i - 1] !== '\\')) i++;
      continue;
    }
    if (c === '(') depth++;
    else if (c === ')') { depth--; if (depth === 0) return i; }
  }
  return -1;
}

/** 괄호 깊이 0 의 콤마로 나눈다 */
function splitTop(body) {
  const out = []; let depth = 0, cur = '';
  for (let i = 0; i < body.length; i++) {
    const c = body[i];
    if (c === "'" || c === '"' || c === '`') {
      const q = c; cur += c; i++;
      while (i < body.length) { cur += body[i]; if (body[i] === q && body[i - 1] !== '\\') break; i++; }
      continue;
    }
    if (c === '(') depth++;
    if (c === ')') depth--;
    if (c === ',' && depth === 0) { out.push(cur); cur = ''; continue; }
    cur += c;
  }
  if (cur.trim()) out.push(cur);
  return out.map(s => s.trim()).filter(Boolean);
}

const colList = s => splitTop(s).map(unquote).filter(Boolean);

export function readSql(src, source = 'input.sql') {
  const ir = emptyIR(source, 'sql');
  const sql = stripComments(src);
  const byName = new Map();

  const addRef = (from, col, to, toCol, evidence) => {
    if (!from || !col || !to) return;
    ir.refs.push({ from, col, to, toCol: toCol || null, evidence: evidence.replace(/\s+/g, ' ').trim(), confidence: 'fact' });
  };

  // ── CREATE TABLE ────────────────────────────────────────
  const reCreate = /CREATE\s+(?:GLOBAL\s+|LOCAL\s+|TEMP(?:ORARY)?\s+|UNLOGGED\s+)*TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?([`"\[\]\w.]+)\s*\(/gi;
  let m;
  while ((m = reCreate.exec(sql))) {
    const open = sql.indexOf('(', m.index + m[0].length - 1);
    const close = matchParen(sql, open);
    if (close < 0) { ir.unparsed.push(m[0].trim()); continue; }
    const { schema, table } = splitName(m[1]);
    if (!table) continue;
    const body = sql.slice(open + 1, close);
    const t = { name: table, group: schema || null, columns: [] };
    if (byName.has(table)) ir.warnings.push('중복 CREATE TABLE: ' + table);
    byName.set(table, t);

    for (const item of splitTop(body)) {
      const head = item.replace(/^\s+/, '');
      const kw = head.toUpperCase();

      // 테이블 레벨 제약
      if (/^(CONSTRAINT\b|PRIMARY\s+KEY\b|FOREIGN\s+KEY\b|UNIQUE\b|CHECK\b|KEY\b|INDEX\b)/.test(kw)) {
        const fk = head.match(/FOREIGN\s+KEY\s*\(([^)]*)\)\s*REFERENCES\s+([`"\[\]\w.]+)\s*(?:\(([^)]*)\))?/i);
        if (fk) {
          const cols = colList(fk[1]);
          const ref = splitName(fk[2]);
          const rcols = fk[3] ? colList(fk[3]) : [];
          cols.forEach((c, i) => addRef(table, c, ref.table, rcols[i] || rcols[0] || null, head));
          continue;
        }
        const pk = head.match(/PRIMARY\s+KEY\s*\(([^)]*)\)/i);
        if (pk) {
          for (const c of colList(pk[1])) {
            const col = t.columns.find(x => x.name === c);
            if (col) { col.pk = true; col.notNull = true; }
          }
        }
        continue;
      }

      // 컬럼 정의
      const cm = head.match(/^([`"\[\]\w]+)\s+([\s\S]+)$/);
      if (!cm) { ir.unparsed.push(head); continue; }
      const name = unquote(cm[1]);
      const rest = cm[2];
      // 타입은 '첫 제약 키워드 앞까지'로 잡는다. 게으른 매칭을 쓰면
      // `uuid NOT NULL` 에서 타입이 'u' 한 글자로 잘린다 — 실제로 그랬다.
      // 'character varying(80)', 'double precision' 같은 다단어 타입도 살아야 한다.
      const STOP = /\b(NOT\s+NULL|NULL|PRIMARY\s+KEY|REFERENCES|DEFAULT|UNIQUE|CHECK|CONSTRAINT|GENERATED|AUTO_INCREMENT|AUTOINCREMENT|IDENTITY|COLLATE|COMMENT|ON\s+UPDATE|ON\s+DELETE)\b/i;
      const stop = rest.match(STOP);
      const type = (stop ? rest.slice(0, stop.index) : rest)
        .trim().replace(/,\s*$/, '').replace(/\s+/g, ' ');
      const col = {
        name, type: type || 'unknown',
        pk: /\bPRIMARY\s+KEY\b/i.test(rest),
        notNull: /\bNOT\s+NULL\b/i.test(rest) || /\bPRIMARY\s+KEY\b/i.test(rest),
      };
      t.columns.push(col);

      // 인라인 REFERENCES
      const inl = rest.match(/\bREFERENCES\s+([`"\[\]\w.]+)\s*(?:\(([^)]*)\))?/i);
      if (inl) {
        const ref = splitName(inl[1]);
        addRef(table, name, ref.table, inl[2] ? colList(inl[2])[0] : null, name + ' ' + rest);
      }
    }
  }

  // ── ALTER TABLE ... FOREIGN KEY ─────────────────────────
  const reAlter = /ALTER\s+TABLE\s+(?:ONLY\s+)?([`"\[\]\w.]+)([\s\S]*?);/gi;
  while ((m = reAlter.exec(sql))) {
    const { table } = splitName(m[1]);
    const tail = m[2];
    const reFk = /FOREIGN\s+KEY\s*\(([^)]*)\)\s*REFERENCES\s+([`"\[\]\w.]+)\s*(?:\(([^)]*)\))?/gi;
    let f;
    while ((f = reFk.exec(tail))) {
      const cols = colList(f[1]);
      const ref = splitName(f[2]);
      const rcols = f[3] ? colList(f[3]) : [];
      cols.forEach((c, i) =>
        addRef(table, c, ref.table, rcols[i] || rcols[0] || null, 'ALTER TABLE ' + m[1] + ' ' + f[0]));
    }
    const pk = tail.match(/PRIMARY\s+KEY\s*\(([^)]*)\)/i);
    if (pk && byName.has(table)) {
      for (const c of colList(pk[1])) {
        const col = byName.get(table).columns.find(x => x.name === c);
        if (col) { col.pk = true; col.notNull = true; }
      }
    }
  }

  // ── COMMENT ON — 카드에 보일 한글명으로 쓴다 ─────────────
  const reComment = /COMMENT\s+ON\s+(TABLE|COLUMN)\s+([`"\[\]\w.]+)\s+IS\s+'((?:[^']|'')*)'/gi;
  while ((m = reComment.exec(sql))) {
    const text = m[3].replace(/''/g, "'").trim();
    if (m[1].toUpperCase() === 'TABLE') {
      const { table } = splitName(m[2]);
      if (byName.has(table)) byName.get(table).label = text;
    } else {
      const parts = String(m[2]).split('.').map(unquote);
      const cname = parts.pop(), tname = parts.pop();
      const t = byName.get(tname);
      const c = t && t.columns.find(x => x.name === cname);
      if (c) c.note = text;
    }
  }

  ir.tables = [...byName.values()];

  // 대상이 정의되지 않은 참조는 버리지 않는다 — 스텁으로 남길 수 있게 표시만 한다
  const known = new Set(ir.tables.map(t => t.name));
  for (const r of ir.refs) if (!known.has(r.to)) r.missingTarget = true;

  if (!ir.tables.length) ir.warnings.push('CREATE TABLE 을 하나도 찾지 못했습니다');
  return ir;
}
