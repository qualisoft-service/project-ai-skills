/* DBML 파서 · 직렬화 — Node 와 브라우저가 같이 쓴다.
   범용 파서가 아니다. 이 체계가 만드는 문법만 읽는다. */

const reTable = /^Table\s+("?)([^"\s{]+)\1\s*\{([\s\S]*?)^\}/gm;
const reGroup = /^TableGroup\s+("?)([^"{]+?)\1\s*\{([\s\S]*?)^\}/gm;
const reRef   = /^Ref:\s*(\S+)\.(\S+)\s*([<>-])\s*(\S+)\.(\S+)\s*$/gm;

function unq(s) { return (s || '').trim().replace(/^"(.*)"$/, '$1'); }

/** Note: '...' 를 꺼낸다. 값 안의 \' 는 살린다. */
function pickNote(body) {
  const m = body.match(/^\s*Note:\s*'((?:[^'\\]|\\.)*)'/m);
  return m ? m[1].replace(/\\'/g, "'") : '';
}

function parseColumns(body) {
  const out = [];
  for (const raw of body.split('\n')) {
    const line = raw.trim();
    if (!line || line.startsWith('//') || /^Note:/.test(line)) continue;
    // name type [settings]
    const m = line.match(/^([A-Za-z_][\w]*)\s+([^\[]+?)(?:\s*\[([\s\S]*)\])?$/);
    if (!m) continue;
    const settings = m[3] || '';
    out.push({
      name: m[1],
      type: m[2].trim(),
      pk: /\bpk\b/.test(settings),
      notNull: /not null/.test(settings),
      note: (settings.match(/note:\s*'((?:[^'\\]|\\.)*)'/) || [, ''])[1].replace(/\\'/g, "'"),
    });
  }
  return out;
}

/** 열린 채 닫히지 않은 블록을 줄 번호와 함께 찾는다.
 *  편집기에서 "실패"만 뜨고 어디가 문제인지 모르면 고칠 수가 없다. */
export function findBlockErrors(src) {
  const lines = src.split('\n');
  const errs = [];
  let open = null, depth = 0;
  lines.forEach((raw, i) => {
    const line = raw.replace(/\/\/.*$/, '');
    const head = line.match(/^\s*(Table|TableGroup|Enum)\b/);
    if (head && depth === 0 && line.includes('{')) { open = { kw: head[1], line: i + 1 }; depth = 1; return; }
    if (!open) {
      if (/^\s*\}/.test(line)) errs.push({ line: i + 1, msg: '짝이 없는 닫는 괄호' });
      return;
    }
    for (const ch of line) { if (ch === '{') depth++; else if (ch === '}') depth--; }
    if (depth <= 0) { open = null; depth = 0; }
  });
  if (open) errs.push({ line: open.line, msg: open.kw + ' 블록이 닫히지 않았습니다' });
  return errs;
}

export function parseDbml(src) {
  const tables = new Map(), groupOf = new Map(), groups = [];
  const refs = [], warnings = [];
  for (const e of findBlockErrors(src)) warnings.push(e.line + '행: ' + e.msg);

  let m;
  reTable.lastIndex = 0;
  while ((m = reTable.exec(src))) {
    const name = m[2], body = m[3];
    if (tables.has(name)) { warnings.push(`중복 Table: ${name}`); continue; }
    const note = pickNote(body);
    const stub = /^문서 밖/.test(note);
    const tot = note.match(/총 속성 (\d+)개/);
    tables.set(name, {
      name,
      label: stub ? name : (note ? note.split(' (')[0] : name),
      note,
      stub,
      custom: /커스텀/.test(note),
      activity: /·활동/.test(note),
      total: tot ? +tot[1] : 0,
      columns: parseColumns(body),
    });
  }

  reGroup.lastIndex = 0;
  while ((m = reGroup.exec(src))) {
    const gname = unq(m[2]), members = [];
    for (const raw of m[3].split('\n')) {
      const t = raw.trim();
      if (!t || t.startsWith('//') || /^Note:/.test(t)) continue;
      if (/^[A-Za-z_][\w]*$/.test(t)) { members.push(t); groupOf.set(t, gname); }
    }
    groups.push({ name: gname, members });
  }

  reRef.lastIndex = 0;
  while ((m = reRef.exec(src))) {
    let [, a, ac, dir, b, bc] = m;
    if (dir === '<') { [a, ac, b, bc] = [b, bc, a, ac]; }   // 방향 정규화: 항상 다 → 일
    if (!tables.has(a)) { warnings.push(`Ref 출발 테이블 없음: ${a}`); continue; }
    if (!tables.has(b)) { warnings.push(`Ref 대상 테이블 없음: ${b}`); continue; }
    refs.push({ from: a, col: ac, to: b, toCol: bc });
  }

  for (const r of refs) {
    const t = tables.get(r.from);
    if (t.columns.length && !t.columns.some(c => c.name === r.col))
      warnings.push(`Ref 출발 컬럼 없음: ${r.from}.${r.col}`);
  }

  return { tables, groups, groupOf, refs, warnings };
}

/** 파싱 결과를 다시 DBML 로. 뷰어에서 편집분을 내보낼 때 쓴다. */
export function toDbml(model) {
  const L = [];
  for (const t of model.tables.values()) {
    L.push(`Table ${t.name} {`);
    for (const c of t.columns) {
      const s = [];
      if (c.pk) s.push('pk');
      if (c.notNull) s.push('not null');
      if (c.note) s.push(`note: '${c.note.replace(/'/g, "\\'")}'`);
      L.push(`  ${c.name} ${c.type}${s.length ? ` [${s.join(', ')}]` : ''}`);
    }
    if (t.note) L.push(`  Note: '${t.note.replace(/'/g, "\\'")}'`);
    L.push('}', '');
  }
  for (const g of model.groups) {
    L.push(`TableGroup "${g.name}" {`);
    for (const x of g.members) L.push(`  ${x}`);
    L.push('}', '');
  }
  for (const r of model.refs) L.push(`Ref: ${r.from}.${r.col} > ${r.to}.${r.toCol}`);
  return L.join('\n') + '\n';
}
