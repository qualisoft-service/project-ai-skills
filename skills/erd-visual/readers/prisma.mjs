/* Prisma schema 판독기.
 *
 * Prisma 는 관계를 선언으로 갖고 있어 근거가 명확하다 (confidence:'fact').
 *   author  User @relation(fields:[authorId], references:[id])
 * 스칼라 필드가 실제 외래키 컬럼이고, 관계 필드는 그 컬럼을 가리킨다.
 * 관계 필드만 보고 선을 그으면 어느 컬럼이 FK 인지 잃어버린다.
 */

import { emptyIR } from './index.mjs';

const stripComments = s => s.replace(/\/\/[^\n]*/g, '');

const SCALARS = new Set(['String', 'Boolean', 'Int', 'BigInt', 'Float', 'Decimal',
  'DateTime', 'Json', 'Bytes', 'Unsupported']);

export function readPrisma(src, source = 'schema.prisma') {
  const ir = emptyIR(source, 'prisma');
  const text = stripComments(src);

  const enums = new Set();
  let e;
  const reEnum = /^\s*enum\s+(\w+)\s*\{/gm;
  while ((e = reEnum.exec(text))) enums.add(e[1]);

  const models = new Map();
  const reModel = /^\s*model\s+(\w+)\s*\{([\s\S]*?)^\s*\}/gm;
  let m;
  while ((m = reModel.exec(text))) {
    const name = m[1], body = m[2];
    const t = { name, label: name, group: null, columns: [] };
    const rels = [];

    for (const raw of body.split('\n')) {
      const line = raw.trim();
      if (!line || line.startsWith('@@')) {
        // @@map("table_name") — 실제 테이블명
        const mm = line.match(/@@map\("([^"]+)"\)/);
        if (mm) t.mapped = mm[1];
        const idm = line.match(/@@id\(\s*\[([^\]]+)\]/);
        if (idm) t.compositeId = idm[1].split(',').map(s => s.trim());
        continue;
      }
      const fm = line.match(/^(\w+)\s+(\w+)(\[\])?(\?)?\s*(.*)$/);
      if (!fm) continue;
      const [, fname, ftype, isList, optional, attrs] = fm;

      const relm = attrs.match(/@relation\(([^)]*)\)/);
      const isScalar = SCALARS.has(ftype) || enums.has(ftype);

      if (isScalar) {
        t.columns.push({
          name: fname,
          type: ftype + (isList ? '[]' : ''),
          pk: /@id\b/.test(attrs),
          notNull: !optional && !isList,
          note: (attrs.match(/@map\("([^"]+)"\)/) || [, ''])[1] || fname,
        });
        continue;
      }

      // 관계 필드 — 목록(1:N 의 N쪽)은 상대편에 FK 가 있으므로 여기선 그리지 않는다
      if (isList) continue;
      if (!relm) {
        // @relation 없는 단일 관계 — FK 컬럼을 특정할 수 없다
        rels.push({ target: ftype, fields: null, refs: null, raw: line });
        continue;
      }
      const fields = (relm[1].match(/fields\s*:\s*\[([^\]]*)\]/) || [, ''])[1]
        .split(',').map(s => s.trim()).filter(Boolean);
      const refs = (relm[1].match(/references\s*:\s*\[([^\]]*)\]/) || [, ''])[1]
        .split(',').map(s => s.trim()).filter(Boolean);
      rels.push({ target: ftype, fields, refs, raw: line });
    }

    models.set(name, { t, rels });
  }

  for (const { t } of models.values()) ir.tables.push(t);

  for (const { t, rels } of models.values()) {
    for (const r of rels) {
      if (!models.has(r.target)) {
        ir.warnings.push(t.name + ': 모델을 찾지 못한 관계 대상 ' + r.target);
        continue;
      }
      if (!r.fields || !r.fields.length) {
        ir.warnings.push(t.name + ' → ' + r.target +
          ': @relation 에 fields 가 없어 외래키 컬럼을 특정할 수 없습니다 (Ref 로 그리지 않음)');
        continue;
      }
      r.fields.forEach((f, i) => {
        ir.refs.push({
          from: t.name, col: f, to: r.target, toCol: (r.refs && r.refs[i]) || null,
          evidence: r.raw, confidence: 'fact',
        });
      });
    }
  }

  if (!ir.tables.length) ir.warnings.push('model 블록을 찾지 못했습니다');
  return ir;
}
