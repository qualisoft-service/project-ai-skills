/* 판독기 공통 계약
 *
 * 판독기는 '파싱'만 한다. "이 시트의 어느 열이 관계 근거인가" 같은 판단은
 * 스킬(SKILL.md 절차)이 한다. 판독기가 알아서 다 해주는 것처럼 만들면
 * 근거 없는 관계가 조용히 섞인다.
 *
 * 모든 판독기는 아래 IR 을 돌려준다.
 *
 *   {
 *     source: 'orders.sql',
 *     format: 'sql',
 *     tables: [{
 *       name, label?, group?,
 *       columns: [{ name, type, pk, notNull, note? }],
 *     }],
 *     refs: [{
 *       from, col, to, toCol,
 *       evidence: '원본에서 이 관계를 뒷받침한 문자열 그대로',
 *       confidence: 'fact' | 'estimate',
 *     }],
 *     warnings: ['읽지 못한 것'],
 *     unparsed: ['통째로 건너뛴 원문 조각'],
 *   }
 *
 * evidence 는 비워 두지 않는다. 1:1 대조 검사가 이걸로 돈다.
 * confidence 가 'estimate' 인 관계는 --infer 없이는 Ref 로 나가지 않는다.
 */

import { readSql } from './sql.mjs';
import { readXlsx } from './xlsx.mjs';
import { readCsv } from './csv.mjs';
import { readXml } from './xml.mjs';
import { readPrisma } from './prisma.mjs';
import { readJsonSchema } from './jsonschema.mjs';

export const READERS = [
  { format: 'sql', ext: ['.sql', '.ddl'], read: readSql },
  { format: 'xlsx', ext: ['.xlsx', '.xlsm'], read: readXlsx, binary: true },
  { format: 'csv', ext: ['.csv', '.tsv'], read: readCsv },
  { format: 'xml', ext: ['.xml'], read: readXml },
  { format: 'prisma', ext: ['.prisma'], read: readPrisma },
  { format: 'jsonschema', ext: ['.json', '.yaml', '.yml'], read: readJsonSchema },
];

export function detect(file) {
  const lower = file.toLowerCase();
  for (const r of READERS) {
    if (r.ext.some(e => lower.endsWith(e))) return r;
  }
  return null;
}

export function emptyIR(source, format) {
  return { source, format, tables: [], refs: [], warnings: [], unparsed: [] };
}
