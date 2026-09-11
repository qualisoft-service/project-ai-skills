/* JSON Schema · OpenAPI 판독기.
 *
 * 주의: 이 형식은 **API 응답 모양**을 기술한다. 테이블도 외래키도 아니다.
 * `$ref` 로 스키마 간 참조는 뽑을 수 있지만 그게 DB 관계라는 보장이 없다.
 * 그래서 여기서 나오는 관계는 전부 confidence:'estimate' 다.
 * --infer 없이는 Ref 로 나가지 않고 report 의 확인 목록으로만 간다.
 */

import { emptyIR } from './index.mjs';

const typeOf = s => {
  if (!s || typeof s !== 'object') return 'unknown';
  if (s.$ref) return 'ref';
  if (Array.isArray(s.type)) return s.type.filter(t => t !== 'null')[0] || 'unknown';
  if (s.type) return s.type + (s.format ? '(' + s.format + ')' : '');
  if (s.enum) return 'enum';
  if (s.oneOf || s.anyOf || s.allOf) return 'composed';
  return 'unknown';
};

const refName = r => String(r).split('/').pop();

export function readJsonSchema(text, source = 'schema.json') {
  const ir = emptyIR(source, 'jsonschema');
  let doc;
  try { doc = JSON.parse(text); }
  catch (err) { ir.warnings.push('JSON 파싱 실패: ' + err.message); return ir; }

  // OpenAPI 3 · Swagger 2 · 순수 JSON Schema 의 정의 위치
  const defs = doc.components?.schemas || doc.definitions || doc.$defs ||
    (doc.type === 'object' && doc.properties ? { [doc.title || 'root']: doc } : null);
  if (!defs) {
    ir.warnings.push('스키마 정의를 찾지 못했습니다 (components.schemas · definitions · $defs)');
    return ir;
  }

  const isObj = s => s && typeof s === 'object' &&
    (s.type === 'object' || s.properties || s.allOf || s.$ref);

  for (const [name, schema] of Object.entries(defs)) {
    if (!isObj(schema)) continue;
    const t = { name, label: schema.title || name, group: null, columns: [] };
    const required = new Set(schema.required || []);

    // allOf 를 얕게 펼친다 (상속 표현으로 흔히 쓴다)
    const props = { ...(schema.properties || {}) };
    for (const part of schema.allOf || []) {
      if (part.properties) Object.assign(props, part.properties);
      if (part.$ref) {
        ir.refs.push({
          from: name, col: '(allOf)', to: refName(part.$ref), toCol: null,
          evidence: 'allOf: ' + part.$ref, confidence: 'estimate',
        });
      }
    }

    for (const [pname, p] of Object.entries(props)) {
      const isArr = p && p.type === 'array';
      const inner = isArr ? (p.items || {}) : (p || {});
      t.columns.push({
        name: pname,
        type: typeOf(inner) + (isArr ? '[]' : ''),
        pk: /^id$/i.test(pname),
        notNull: required.has(pname),
        note: (p && (p.description || p.title)) || pname,
      });
      if (inner && inner.$ref) {
        ir.refs.push({
          from: name, col: pname, to: refName(inner.$ref), toCol: null,
          evidence: pname + '.$ref = ' + inner.$ref,
          confidence: 'estimate',
        });
      }
    }
    ir.tables.push(t);
  }

  const known = new Set(ir.tables.map(t => t.name));
  for (const r of ir.refs) if (!known.has(r.to)) r.missingTarget = true;

  if (!ir.tables.length) ir.warnings.push('객체 스키마를 하나도 찾지 못했습니다');
  if (ir.refs.length)
    ir.warnings.push('이 형식의 참조 ' + ir.refs.length + '건은 전부 추정입니다 — '
      + 'API 응답 구조이지 DB 외래키가 아닙니다. --infer 로만 Ref 가 됩니다');
  return ir;
}
