/* XML 판독기.
 *
 * XML 에는 표준 스키마 형태가 없다. 자료마다 뜻이 다르므로
 * 매핑 없이는 **구조만 보고**한다.
 *
 * 가장 쓸모 있는 쓰임은 테이블 추출이 아니라 **그룹 힌트**다.
 * Dynamics SiteMap 처럼 "어느 엔티티가 어느 업무 영역에 속하는가"를 담은 자료가 있으면
 * 그걸로 TableGroup 을 만들 수 있다. 그룹은 배선 품질과 속도를 크게 좌우한다.
 */

import { emptyIR } from './index.mjs';

const ENT = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
const unesc = s => String(s).replace(/&(#x?[0-9a-fA-F]+|\w+);/g, (m, e) => {
  if (e[0] === '#') return String.fromCodePoint(e[1] === 'x' || e[1] === 'X'
    ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10));
  return ENT[e] ?? m;
});

const localName = n => String(n).replace(/^.*:/, '');

function parseAttrs(s) {
  const a = {};
  const re = /([\w:.-]+)\s*=\s*"([^"]*)"|([\w:.-]+)\s*=\s*'([^']*)'/g;
  let m;
  while ((m = re.exec(s))) {
    const k = localName(m[1] || m[3]);
    a[k] = unesc(m[2] ?? m[4] ?? '');
  }
  return a;
}

/** 태그 스트림을 훑으며 스택으로 깊이를 추적한다 (외부 파서 없이) */
export function walk(xml, onOpen, onClose) {
  const clean = xml
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<!\[CDATA\[[\s\S]*?\]\]>/g, '')
    .replace(/<\?[\s\S]*?\?>/g, '')
    .replace(/<!DOCTYPE[^>]*>/gi, '');
  const re = /<\s*(\/)?\s*([\w:.-]+)((?:"[^"]*"|'[^']*'|[^>"'])*?)(\/)?>/g;
  let m;
  while ((m = re.exec(clean))) {
    const [, closing, rawName, attrStr, selfClose] = m;
    const name = localName(rawName);
    if (closing) { onClose(name); continue; }
    onOpen(name, parseAttrs(attrStr || ''));
    if (selfClose) onClose(name);
  }
}

/** 구조 보고 — 어떤 요소가 몇 번 나오고 어떤 속성을 갖는지 */
function survey(xml) {
  const els = new Map();
  const stack = [];
  walk(xml,
    (name, attrs) => {
      if (!els.has(name)) els.set(name, { name, count: 0, attrs: new Map(), parents: new Set() });
      const e = els.get(name);
      e.count++;
      if (stack.length) e.parents.add(stack[stack.length - 1]);
      for (const [k, v] of Object.entries(attrs)) {
        if (!e.attrs.has(k)) e.attrs.set(k, { count: 0, sample: v });
        e.attrs.get(k).count++;
      }
      stack.push(name);
    },
    () => { stack.pop(); });
  return [...els.values()]
    .sort((a, b) => b.count - a.count)
    .map(e => ({
      name: e.name, count: e.count,
      parents: [...e.parents].slice(0, 3),
      attrs: [...e.attrs].map(([k, v]) => ({ name: k, count: v.count, sample: v.sample })),
    }));
}

/**
 * 매핑 규격
 * {
 *   "groups": {                      // 그룹 힌트 추출
 *     "container": "Area",           // 영역을 뜻하는 요소
 *     "containerName": "Id",         // 그 요소의 어느 속성이 이름인가
 *     "member": "SubArea",           // 그 안에서 엔티티를 가리키는 요소
 *     "memberEntity": "Entity"       // 그 요소의 어느 속성이 엔티티명인가
 *   }
 * }
 */
export function readXml(text, source = 'input.xml', opt = {}) {
  const ir = emptyIR(source, 'xml');
  const map = opt.map || null;

  if (!map || !map.groups) {
    ir.elements = survey(text);
    ir.needsMapping = true;
    const top = ir.elements.slice(0, 6).map(e => e.name + '×' + e.count).join(', ');
    ir.warnings.push('XML 은 자료마다 뜻이 달라 매핑이 필요합니다. 주요 요소: ' + top
      + ' (그룹 힌트를 뽑으려면 --map 의 groups 를 채우세요)');
    return ir;
  }

  const G = map.groups;
  const hints = new Map();
  const stack = [];
  let curGroup = null, groupDepth = -1;

  walk(text,
    (name, attrs) => {
      stack.push(name);
      if (name === G.container) {
        const gname = (attrs[G.containerName] || '').trim();
        if (gname) { curGroup = gname; groupDepth = stack.length; }
      } else if (curGroup && name === G.member) {
        const ent = (attrs[G.memberEntity] || '').trim();
        // 엔티티명이 아닌 URL·웹리소스는 거른다
        if (ent && /^[A-Za-z_][\w]*$/.test(ent) && !hints.has(ent)) hints.set(ent, curGroup);
      }
    },
    name => {
      if (name === G.container && stack.length === groupDepth) { curGroup = null; groupDepth = -1; }
      stack.pop();
    });

  ir.groupHints = [...hints].map(([entity, group]) => ({ entity, group }));
  ir.elements = survey(text);
  if (!ir.groupHints.length)
    ir.warnings.push('그룹 힌트를 하나도 뽑지 못했습니다 — container/member 요소 이름을 확인하세요');
  else
    ir.warnings.push('그룹 힌트 ' + ir.groupHints.length + '건을 뽑았습니다 (테이블·관계는 없음)');
  return ir;
}
