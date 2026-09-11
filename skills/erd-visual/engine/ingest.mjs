/* 흡수 — 판독기 IR 을 DBML 로.
 *
 * 이 단계의 일은 요약이 아니라 **사실과 추정을 가르는 것**이다.
 * 근거(evidence)가 없는 관계는 여기서 나가지 못한다.
 */

/** 렌더러가 읽는 Note 형식으로 만든다 */
function tableNote(t, total, shown, stub) {
  if (stub) return '문서 밖 엔티티 · 이 문서에 정의 없음 · 피참조 ' + (t.inbound || 0) + '건';
  const label = t.label || t.name;
  const kind = t.custom ? '커스텀' : '표준';
  return label + ' (' + t.name + ') · ' + kind + ' · 총 속성 ' + total + '개 · 표시 ' + shown + '개';
}

const q = s => String(s ?? '').replace(/'/g, "\\'").replace(/\n/g, ' ');

/**
 * @param irs  판독기 IR 배열
 * @param opt  { infer: boolean, project: string }
 */
export function toDbml(irs, opt = {}) {
  const infer = !!opt.infer;
  const tables = new Map();
  const groups = new Map();
  const refs = [];
  const dropped = [];
  const warnings = [];
  const unparsed = [];

  // ── 테이블 병합 ──────────────────────────────────────────
  for (const ir of irs) {
    for (const w of ir.warnings) warnings.push(ir.source + ': ' + w);
    for (const u of ir.unparsed) unparsed.push(ir.source + ': ' + u);
    for (const t of ir.tables) {
      if (tables.has(t.name)) {
        warnings.push('중복 테이블 ' + t.name + ' (' + ir.source + ') — 먼저 읽은 정의를 유지합니다');
        continue;
      }
      tables.set(t.name, { ...t, columns: t.columns.slice(), source: ir.source, inbound: 0 });
      if (t.group) {
        if (!groups.has(t.group)) groups.set(t.group, []);
        groups.get(t.group).push(t.name);
      }
    }
  }

  // ── 관계 — 근거가 있는 것만 ──────────────────────────────
  const seen = new Set();
  for (const ir of irs) {
    for (const r of ir.refs) {
      if (!r.evidence) { dropped.push({ ...r, reason: '근거 문자열이 없음' }); continue; }
      if (r.confidence === 'estimate' && !infer) {
        dropped.push({ ...r, reason: '추정 관계 (--infer 없이는 Ref 로 내보내지 않음)' });
        continue;
      }
      const k = r.from + '.' + r.col + '>' + r.to;
      if (seen.has(k)) continue;
      seen.add(k);
      refs.push({ ...r, source: ir.source });
    }
  }

  // ── 그룹 힌트 적용 (SiteMap 류 XML 이 준 것) ──────────────
  const hints = new Map();
  for (const ir of irs) for (const h of ir.groupHints || []) hints.set(h.entity, h.group);
  if (hints.size) {
    let applied = 0;
    for (const [name, t] of tables) {
      const g = hints.get(name);
      if (!g || t.group) continue;
      t.group = g; applied++;
      if (!groups.has(g)) groups.set(g, []);
      groups.get(g).push(name);
    }
    warnings.push('그룹 힌트 ' + hints.size + '건 중 ' + applied + '건을 적용했습니다');
  }

  // ── 참조 대상이 정의에 없으면 스텁으로 남긴다 ─────────────
  for (const r of refs) {
    if (!tables.has(r.to)) {
      tables.set(r.to, {
        name: r.to, stub: true, columns: [{ name: (r.toCol || r.to + 'id'), type: 'uniqueidentifier', pk: true }],
        inbound: 0, source: '(정의 없음)',
      });
      warnings.push('참조 대상이 정의에 없어 스텁으로 남깁니다: ' + r.to);
    }
  }
  for (const r of refs) tables.get(r.to).inbound++;

  // 스텁의 PK 이름을 실제 참조 컬럼에 맞춘다
  for (const r of refs) {
    const t = tables.get(r.to);
    if (t.stub && r.toCol) t.columns[0].name = r.toCol;
  }

  // ── 그룹 — 근거가 있을 때만. 없으면 억지로 묶지 않는다 ────
  const grouped = new Set([...groups.values()].flat());
  const ungrouped = [...tables.keys()].filter(n => !grouped.has(n));
  if (ungrouped.length) {
    const stubs = ungrouped.filter(n => tables.get(n).stub);
    const rest = ungrouped.filter(n => !tables.get(n).stub);
    if (rest.length) groups.set(opt.project || '전체', rest);
    if (stubs.length) groups.set('문서 밖', stubs);
  }

  // ── DBML 직렬화 ─────────────────────────────────────────
  const L = [];
  L.push('// ' + (opt.project || 'schema') + ' — erd-visual ingest');
  L.push('// 원본: ' + irs.map(i => i.source).join(', '));
  L.push('// 생성: ' + new Date().toISOString().slice(0, 10));
  L.push('//');
  L.push('// 관계는 원본의 명시적 근거에서만 뽑았습니다.');
  L.push('// 추정 관계' + (infer ? '는 컬럼 note 에 "추정:" 으로 표시했습니다.' : '은 포함하지 않았습니다.'));
  L.push('');

  for (const [gname, members] of groups) {
    if (!members.length) continue;
    L.push('// ─── ' + gname + ' ' + '─'.repeat(Math.max(0, 40 - gname.length)));
    L.push('');
    for (const name of members) {
      const t = tables.get(name);
      const cols = t.columns || [];
      L.push('Table ' + name + ' {');
      for (const c of cols) {
        const s = [];
        if (c.pk) s.push('pk');
        if (c.notNull) s.push('not null');
        const rr = refs.find(r => r.from === name && r.col === c.name);
        let note = c.note || c.name;
        if (rr) note += ' → ' + rr.to;
        if (c.estimate) note = '추정: ' + note;
        s.push("note: '" + q(note) + "'");
        L.push('  ' + c.name + ' ' + (c.type || 'unknown') + ' [' + s.join(', ') + ']');
      }
      L.push("  Note: '" + q(tableNote(t, cols.length, cols.length, t.stub)) + "'");
      L.push('}');
      L.push('');
    }
    L.push('TableGroup "' + gname + '" {');
    for (const n of members) L.push('  ' + n);
    L.push('}');
    L.push('');
  }

  L.push('// ═══════ 관계 — 원본에 근거가 있는 것만 ═══════');
  L.push('');
  for (const r of refs) {
    const target = tables.get(r.to);
    const toCol = r.toCol || (target.columns[0] && target.columns[0].name) || (r.to + 'id');
    L.push('Ref: ' + r.from + '.' + r.col + ' > ' + r.to + '.' + toCol);
  }
  L.push('');

  return {
    dbml: L.join('\n'),
    tables, groups, refs, dropped, warnings, unparsed,
    stubs: [...tables.values()].filter(t => t.stub).map(t => t.name),
  };
}

/** 뽑은 Ref 가 전부 원본 근거로 되짚어지는가 — 누락·창작 0 이어야 한다 */
export function reconcile(irs, result) {
  const srcFacts = new Set();
  const srcEstimates = new Set();
  for (const ir of irs) {
    for (const r of ir.refs) {
      const k = r.from + '.' + r.col + '>' + r.to;
      (r.confidence === 'estimate' ? srcEstimates : srcFacts).add(k);
    }
  }
  const out = new Set(result.refs.map(r => r.from + '.' + r.col + '>' + r.to));

  const invented = [...out].filter(k => !srcFacts.has(k) && !srcEstimates.has(k));
  const missing = [...srcFacts].filter(k => !out.has(k));
  const noEvidence = result.refs.filter(r => !r.evidence);

  return {
    ok: invented.length === 0 && missing.length === 0 && noEvidence.length === 0,
    sourceFacts: srcFacts.size,
    sourceEstimates: srcEstimates.size,
    emitted: out.size,
    invented,
    missing,
    noEvidence: noEvidence.map(r => r.from + '.' + r.col),
    droppedEstimates: result.dropped.filter(d => d.confidence === 'estimate').length,
  };
}

export function reportMd(irs, result, rec, opt = {}) {
  const L = [];
  const now = new Date().toISOString().slice(0, 10);
  L.push('# ' + (opt.project || 'schema') + ' — 흡수 보고서');
  L.push('');
  L.push('| | |');
  L.push('| --- | --- |');
  L.push('| 생성 | ' + now + ' |');
  L.push('| 원본 | ' + irs.map(i => '`' + i.source + '`').join(' · ') + ' |');
  L.push('| 산출 | 테이블 ' + result.tables.size + ' · 관계 ' + result.refs.length +
    ' · 그룹 ' + result.groups.size + ' |');
  L.push('');

  L.push('## 관계를 어떻게 뽑았나');
  L.push('');
  L.push('| 항목 | 수 |');
  L.push('| --- | --- |');
  L.push('| 원본의 명시적 근거 (사실) | ' + rec.sourceFacts + ' |');
  L.push('| 원본의 추정 근거 | ' + rec.sourceEstimates + ' |');
  L.push('| **DBML 에 나간 Ref** | **' + rec.emitted + '** |');
  L.push('| 추정이라 제외됨 | ' + rec.droppedEstimates + ' |');
  L.push('');
  L.push('### 1:1 대조');
  L.push('');
  L.push('| 검사 | 결과 |');
  L.push('| --- | --- |');
  L.push('| 원본에 있으나 빠진 관계 | ' + (rec.missing.length || '0') + ' |');
  L.push('| 원본에 없는데 만들어진 관계 | ' + (rec.invented.length || '0') + ' |');
  L.push('| 근거 문자열이 없는 관계 | ' + (rec.noEvidence.length || '0') + ' |');
  L.push('');
  L.push(rec.ok
    ? '**대조 통과.** 모든 Ref 가 원본 근거로 되짚어집니다.'
    : '**대조 실패.** 아래를 확인하세요.');
  if (rec.missing.length) { L.push(''); L.push('빠진 관계:'); rec.missing.slice(0, 20).forEach(k => L.push('- `' + k + '`')); }
  if (rec.invented.length) { L.push(''); L.push('근거 없는 관계:'); rec.invented.slice(0, 20).forEach(k => L.push('- `' + k + '`')); }
  L.push('');

  if (result.dropped.length) {
    L.push('## 확인이 필요한 것 — 제외된 관계');
    L.push('');
    L.push('아래는 **그리지 않았습니다.** 맞다고 판단되면 `schema.dbml` 에 `Ref:` 를 직접 추가하세요.');
    L.push('');
    L.push('| 출발 | 컬럼 | 대상 | 제외 사유 | 근거 |');
    L.push('| --- | --- | --- | --- | --- |');
    for (const d of result.dropped.slice(0, 40))
      L.push('| `' + d.from + '` | `' + d.col + '` | `' + d.to + '` | ' + d.reason +
        ' | ' + (d.evidence ? '`' + String(d.evidence).slice(0, 60) + '`' : '없음') + ' |');
    L.push('');
  }

  if (result.stubs.length) {
    L.push('## 참조되지만 정의가 없는 테이블');
    L.push('');
    L.push('관계는 사실이므로 버리지 않고 **점선 스텁**으로 남겼습니다. 컬럼은 알 수 없습니다.');
    L.push('');
    result.stubs.forEach(s => L.push('- `' + s + '`'));
    L.push('');
  }

  if (result.warnings.length) {
    L.push('## 경고');
    L.push('');
    result.warnings.slice(0, 30).forEach(w => L.push('- ' + w));
    L.push('');
  }

  if (result.unparsed.length) {
    L.push('## 읽지 못한 원문');
    L.push('');
    L.push('건너뛴 조각입니다. 중요한 정의가 섞여 있으면 알려주세요.');
    L.push('');
    result.unparsed.slice(0, 20).forEach(u => L.push('- `' + String(u).slice(0, 100) + '`'));
    L.push('');
  }

  L.push('## 확인하지 못한 것');
  L.push('');
  L.push('| 항목 | 이유 |');
  L.push('| --- | --- |');
  L.push('| 카디널리티 (1:1 / 1:N) | 원본에 유일성 제약 정보가 없으면 판정할 수 없습니다. **모든 관계를 N:1 로 그렸습니다.** |');
  L.push('| 삭제 동작 (Cascade / Restrict) | DBML 로 옮기지 않았습니다. |');
  L.push('| 그룹 분류의 타당성 | 스키마 이름을 그대로 썼습니다. 업무 영역과 다르면 `TableGroup` 을 손으로 고치세요. |');
  L.push('');
  return L.join('\n');
}
