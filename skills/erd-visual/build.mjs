#!/usr/bin/env node
/* erd-visual — DBML 을 시각 ERD HTML 로 만든다.
 *
 *   node build.mjs build --dbml=ERD/schema.dbml [--out=ERD/erd.html] [--title="..."]
 *   node build.mjs check --dbml=ERD/schema.dbml
 *   node build.mjs selftest
 *
 * 엔진(engine/)은 Node 와 브라우저가 같이 쓴다. 두 벌로 나누면 반드시 갈라진다.
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { parseDbml } from './engine/dbml.mjs';
import { layout } from './engine/layout.mjs';
import { wire } from './engine/wire.mjs';
import { renderDetail, palette } from './engine/render.mjs';
import {
  measureOverlap, checkPierce, checkCardOverlap, checkBounds, checkPathBounds,
  checkTextFit, fitText, report,
} from './engine/verify.mjs';
import { toDbml, reconcile, reportMd } from './engine/ingest.mjs';
import { renderOverview, verifyOverview, overviewFit, autoOverview } from './engine/overview.mjs';
import { detect, READERS } from './readers/index.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const argv = process.argv.slice(2);
const cmd = argv[0];
const arg = (k, d) => {
  const m = argv.find(a => a.startsWith('--' + k + '='));
  return m ? m.slice(k.length + 3) : d;
};
const die = m => { console.error(m); process.exit(1); };

/* ── 모델 준비 ─────────────────────────────────────────── */
function loadOverview(dbmlPath) {
  const explicit = arg('overview');
  const p = explicit || path.join(path.dirname(dbmlPath), 'overview.json');
  if (!fs.existsSync(p)) {
    if (explicit) die('없는 파일: ' + p);
    return null;
  }
  try { return { path: p, spec: JSON.parse(fs.readFileSync(p, 'utf8')) }; }
  catch (e) { die('조감도 명세를 읽지 못했습니다 (' + p + '): ' + e.message); }
}

/** 손으로 그린 명세를 쓸지, DBML 에서 자동 생성할지 고른다.
 *  스키마를 바꾸면 옛 명세는 '고칠 N건'이 아니라 해당 없는 그림이다. */
function pickOverview(dbmlPath, model, lay) {
  const cur = loadOverview(dbmlPath);
  if (cur) {
    const fit = overviewFit(cur.spec, model);
    if (fit.applicable) return { ...cur, fit, auto: false };
    console.log('조감도 명세가 이 스키마와 맞지 않습니다 (' + cur.path + ')');
    console.log('  노드 ' + fit.total + '개 중 ' + fit.alive + '개만 이 DBML 에 존재합니다.');
    console.log('  다른 스키마용 그림으로 보고 자동 생성으로 대체합니다.');
    return { path: '(자동 생성)', spec: autoOverview(model, lay), fit, auto: true };
  }
  return { path: '(자동 생성)', spec: autoOverview(model, lay), fit: null, auto: true };
}

function printOverview(ov, ovc) {
  console.log('조감도: ' + ov.path + (ov.auto ? '  — DBML 에서 자동 생성' : ''));
  console.log('  노드 ' + (ov.spec.nodes || []).length +
    ' · 연결 ' + ovc.edges + ' · 없는연결 ' + ovc.gaps);
  const rows = [
    ['근거 없는 연결', ovc.edgeNoEvidence.length],
    ['사실과 어긋난 없는연결', ovc.gapContradicted.length],
    ['존재하지 않는 테이블', ovc.missingTables.length],
    ['정의되지 않은 노드 참조', ovc.badRef.length],
  ];
  for (const [k, n] of rows) console.log('  ' + k.padEnd(22) + (n === 0 ? '0' : n + '  ← 실패'));
  ovc.edgeNoEvidence.slice(0, 5).forEach(e =>
    console.log('    근거없음: ' + e.from + ' → ' + e.to + (e.label ? '  (' + e.label + ')' : '')));
  ovc.gapContradicted.slice(0, 5).forEach(g =>
    console.log('    실제로는 있음: ' + g.from + ' ↔ ' + g.to + '  ' +
      g.found.map(r => r.from + '.' + r.col + '>' + r.to).join(', ')));
  ovc.missingTables.slice(0, 5).forEach(m =>
    console.log('    없는 테이블: ' + m.node + ' → ' + m.table));
  console.log('  ' + (ovc.ok ? '조감도 대조 통과' : '조감도 대조 실패'));
}

function prepare(dbmlPath) {
  if (!fs.existsSync(dbmlPath)) die('없는 파일: ' + dbmlPath);
  const src = fs.readFileSync(dbmlPath, 'utf8');
  const model = parseDbml(src);
  if (!model.tables.size) die('Table 을 하나도 읽지 못했습니다: ' + dbmlPath);
  const lay = layout(model);
  const w = wire(model, lay);
  return { src, model, lay, w };
}

/* ── 검증 ──────────────────────────────────────────────── */
function verify({ model, lay, w }) {
  const g = lay.geo, INNER = g.CW - 30;

  // 실패 판정은 '렌더된' 문자열로 한다. 원본을 재면 자르기가 필요했던 것까지
  // 넘침으로 잡혀 거짓 실패가 난다 — 실제로 한 번 그렇게 났다.
  const items = [];
  let truncated = 0;
  for (const [t] of lay.pos) {
    const m = model.tables.get(t);
    const label = fitText(m.label, INNER, 15.5);
    const logical = fitText(t, INNER - 26, 11, 1.0, 0.62);
    if (label !== m.label || logical !== t) truncated++;
    items.push({ key: t, text: label, px: 15.5, maxPx: INNER });
    items.push({ key: t, text: logical, px: 11, asc: 0.62, maxPx: INNER - 26 });
  }

  return {
    pierce: checkPierce(w.paths, w.RECT, w.skips).map(i => model.refs[i]),
    bundlePierce: checkPierce(w.bundlePaths, w.bundleRect, w.bundleSkips),
    cardOverlap: checkCardOverlap(w.RECT, w.names),
    bounds: checkBounds(w.RECT, lay.W, lay.H),
    pathBounds: checkPathBounds(w.paths, lay.W, lay.H),
    bundleBounds: checkPathBounds(w.bundlePaths, lay.W, lay.H),
    textFit: checkTextFit(items),
    truncated,
    overlap: measureOverlap(w.paths),
    bundleOverlap: measureOverlap(w.bundlePaths),
    routeFail: w.fail,
  };
}

/* ── 엔진을 브라우저용으로 인라인 ───────────────────────── */
const ENGINE_ORDER = ['router.mjs', 'verify.mjs', 'dbml.mjs', 'layout.mjs', 'wire.mjs',
  'render.mjs', 'overview.mjs'];
// ingest.mjs 만 Node 전용이다 (파일을 읽는다).
// overview.mjs 는 뷰어에도 싣는다 — DBML 을 고치면 조감도의 근거도 다시 대조해야 한다.
// 배치는 사람이 정한 것이라 그대로 두고, '근거가 맞는지'만 다시 판정한다.
function inlineEngine() {
  return ENGINE_ORDER.map(f => {
    let s = fs.readFileSync(path.join(HERE, 'engine', f), 'utf8');
    s = s.replace(/^\s*import[\s\S]*?from\s*['"][^'"]+['"];?\s*$/gm, '');
    s = s.replace(/^export\s+/gm, '');
    return '/* ===== engine/' + f + ' ===== */\n' + s;
  }).join('\n');
}

/* ── build ─────────────────────────────────────────────── */
function cmdBuild() {
  const dbmlPath = arg('dbml') || die('--dbml=<경로> 가 필요합니다');
  const out = arg('out') || path.join(path.dirname(dbmlPath), 'erd.html');
  const ctx = prepare(dbmlPath);
  const { model, lay, w, src } = ctx;

  const title = arg('title') || path.basename(dbmlPath, '.dbml') + ' — ERD';
  const subtitle = '테이블 ' + model.tables.size + ' · 관계 ' + model.refs.length +
    ' · 그룹 ' + lay.order.length + ' · 직각 배선';

  const svg = renderDetail(model, lay, w, { title, subtitle, palette: palette(lay.order) });
  const v = verify(ctx);
  const rep = report(v);

  const ov = pickOverview(dbmlPath, model, lay);
  const ovc = verifyOverview(ov.spec, model);
  const ovSvg = renderOverview(ov.spec, model);

  const tpl = fs.readFileSync(path.join(HERE, 'viewer', 'index.html'), 'utf8');
  const meta = {
    title,
    tables: model.tables.size,
    refs: model.refs.length,
    groups: lay.order.length,
    biz: w.isSysRef.filter(x => !x).length,
    sys: w.isSysRef.filter(x => x).length,
    bundles: w.bundleKeys.length,
    order: lay.order,
    palette: Object.fromEntries(lay.order.map((d, i) => [d, palette(lay.order).get(d)])),
    check: rep,
    hasOverview: true,
    overviewAuto: ov.auto,
    overviewCheck: ovc,
  };
  const nbr = {};
  for (const r of model.refs) {
    (nbr[r.from] ||= []).push({ o: r.to, col: r.col, dir: 'out' });
    (nbr[r.to] ||= []).push({ o: r.from, col: r.col, dir: 'in' });
  }
  const tmeta = {};
  for (const [t, p] of lay.pos) {
    const m = model.tables.get(t);
    tmeta[t] = { ko: m.label, dom: p.dom, total: m.total, stub: m.stub, custom: m.custom };
  }

  const html = tpl
    .replace('/*__ENGINE__*/', () => inlineEngine())
    .replace('__DBML__', () => JSON.stringify(src))
    .replace('__SVG__', () => svg)
    .replace('__OVSVG__', () => ovSvg)
    .replace('__OVSPEC__', () => JSON.stringify(ov.auto ? null : ov.spec))
    .replace('__META__', () => JSON.stringify(meta))
    .replace('__NBR__', () => JSON.stringify(nbr))
    .replace('__TMETA__', () => JSON.stringify(tmeta));

  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, html);
  const svgOut = out.replace(/\.html$/, '.svg');
  fs.writeFileSync(svgOut, svg);
  fs.writeFileSync(out.replace(/\.html$/, '-overview.svg'), ovSvg);

  console.log('생성됨: ' + out + '  (' + (fs.statSync(out).size / 1024).toFixed(0) + ' KB)');
  console.log('        ' + svgOut + '  (Figma import 용)');
  console.log('테이블 ' + model.tables.size + ' · 관계 ' + model.refs.length +
    ' · 번들 ' + w.bundleKeys.length + ' · 캔버스 ' + lay.W + 'x' + lay.H);
  printCheck(v, rep);
  console.log(''); printOverview(ov, ovc);
  if (!rep.ok || !ovc.ok) process.exitCode = 1;
}

function printCheck(v, rep) {
  for (const [k, n] of rep.must) console.log('  ' + k.padEnd(12) + (n === 0 ? '0' : n + '  ← 실패'));
  console.log('  ' + '겹침'.padEnd(12) + v.overlap.overlapPairs + '쌍 / ' +
    v.overlap.overlapLen + 'px  (구간 ' + v.overlap.segments + ')');
  console.log('  ' + '번들 겹침'.padEnd(11) + v.bundleOverlap.overlapPairs + '쌍 / ' +
    v.bundleOverlap.overlapLen + 'px');
  console.log('  ' + '이름 잘림'.padEnd(11) + v.truncated + '개  (카드 폭에 맞춰 … 로 자름 · 전체 이름은 툴팁)');
  if (v.routeFail) console.log('  배선 실패 ' + v.routeFail + '건');
  console.log(rep.ok ? '검증 통과' : '검증 실패 — ' + rep.failed.map(f => f[0]).join(', '));
}

/* ── check ─────────────────────────────────────────────── */
function cmdCheck() {
  const dbmlPath = arg('dbml') || die('--dbml=<경로> 가 필요합니다');
  const ctx = prepare(dbmlPath);
  if (ctx.model.warnings.length) {
    console.log('DBML 경고 ' + ctx.model.warnings.length + '건:');
    ctx.model.warnings.slice(0, 10).forEach(x => console.log('  · ' + x));
  }
  const v = verify(ctx);
  const rep = report(v);
  console.log('테이블 ' + ctx.model.tables.size + ' · 관계 ' + ctx.model.refs.length);
  printCheck(v, rep);
  if (v.pierce.length)
    v.pierce.slice(0, 5).forEach(r => console.log('    관통: ' + r.from + '.' + r.col + ' -> ' + r.to));
  if (v.textFit.length)
    v.textFit.slice(0, 5).forEach(t => console.log('    넘침: ' + t.key + ' "' + t.text + '" +' + t.over + 'px'));
  v.pathBounds.slice(0, 3).forEach(b =>
    console.log('    배선 이탈: ' + ctx.model.refs[b.i].from + ' -> ' + ctx.model.refs[b.i].to +
      ' @ ' + b.at.join(',')));
  v.bundleBounds.slice(0, 3).forEach(b =>
    console.log('    번들 이탈: ' + w0(ctx).bundleKeys[b.i].join(' -> ') + ' @ ' + b.at.join(',')));

  const ov = pickOverview(dbmlPath, ctx.model, ctx.lay);
  const ovc = verifyOverview(ov.spec, ctx.model);
  console.log('');
  printOverview(ov, ovc);
  if (!rep.ok || !ovc.ok) process.exitCode = 1;
}

const w0 = ctx => ctx.w;

/* ── selftest ──────────────────────────────────────────── */
function cmdSelftest() {
  const dir = path.join(HERE, 'fixtures');
  const files = fs.existsSync(dir) ? fs.readdirSync(dir).filter(f => f.endsWith('.dbml')) : [];
  if (!files.length) { console.log('fixtures 없음 — 건너뜀'); return; }
  let bad = 0;
  for (const f of files) {
    const ctx = prepare(path.join(dir, f));
    const rep = report(verify(ctx));
    console.log((rep.ok ? 'PASS  ' : 'FAIL  ') + f +
      '  (테이블 ' + ctx.model.tables.size + ' · 관계 ' + ctx.model.refs.length + ')');
    if (!rep.ok) { bad++; rep.failed.forEach(x => console.log('        ' + x[0] + ' ' + x[1])); }
  }
  console.log(bad ? bad + '건 실패' : files.length + '건 전부 통과');
  if (bad) process.exitCode = 1;
}

/* ── ingest ────────────────────────────────────────────── */
function collectFiles(src) {
  const st = fs.statSync(src);
  if (st.isFile()) return [src];
  const out = [];
  for (const e of fs.readdirSync(src, { withFileTypes: true })) {
    const p = path.join(src, e.name);
    if (e.isDirectory()) out.push(...collectFiles(p));
    else out.push(p);
  }
  return out.sort();
}

function readAll(src, map) {
  const files = collectFiles(src);
  const irs = [], skipped = [];
  for (const f of files) {
    const r = detect(f);
    if (!r) { skipped.push(f); continue; }
    const rel = path.relative(process.cwd(), f);
    const label = rel.startsWith('..') ? path.basename(f) : rel;
    const data = r.binary ? fs.readFileSync(f) : fs.readFileSync(f, 'utf8');
    irs.push(r.read(data, label, map ? { map: map[label] || map[path.basename(f)] || map } : {}));
  }
  return { irs, skipped };
}

/* 구조만 보고한다. 스스로 스키마를 만들지 않는다 —
   어느 열이 무엇인지는 자료마다 다르고, 그건 판단의 영역이다. */
function cmdInspect() {
  const src = arg('src') || die('--src=<파일 또는 폴더> 가 필요합니다');
  if (!fs.existsSync(src)) die('없는 경로: ' + src);
  const { irs, skipped } = readAll(src, null);
  if (!irs.length) {
    console.log('읽을 수 있는 파일이 없습니다. 지원: ' + READERS.flatMap(r => r.ext).join(' '));
    skipped.slice(0, 10).forEach(f => console.log('  건너뜀 · ' + path.basename(f)));
    return;
  }
  for (const ir of irs) {
    console.log('');
    console.log('■ ' + ir.source + '  [' + ir.format + ']');
    if (ir.tables.length) {
      console.log('  테이블 ' + ir.tables.length + ' · 관계 ' + ir.refs.length + '  (근거가 명시된 형식)');
      ir.tables.slice(0, 12).forEach(t =>
        console.log('    · ' + t.name + '  컬럼 ' + t.columns.length + (t.group ? '  [' + t.group + ']' : '')));
      if (ir.tables.length > 12) console.log('    … 외 ' + (ir.tables.length - 12) + '개');
    }
    for (const sh of ir.sheets || []) {
      console.log('  시트 "' + sh.name + '"  데이터 ' + sh.dataRows + '행 · 열 ' + sh.columns.length + '개');
      sh.columns.filter(c => c.header).forEach(c =>
        console.log('     ' + c.col.padEnd(4) + c.header));
      if (sh.sample.length) {
        const first = sh.sample[0];
        const shown = sh.columns.filter(c => c.header).slice(0, 4)
          .map(c => c.col + '=' + String(first[c.col] || '').slice(0, 28));
        console.log('     예시행: ' + shown.join(' | '));
      }
    }
    ir.warnings.forEach(w => console.log('  ⚠ ' + w));
  }
  console.log('');
  if (irs.some(ir => ir.needsMapping)) {
    console.log('매핑이 필요한 형식이 있습니다 — --map=map.json 으로 어느 열/요소가 무엇인지 알려주세요.');
    console.log('  xlsx·csv 규격: readers/xlsx.mjs 상단 주석   ·   xml 규격: readers/xml.mjs 상단 주석');
    console.log('  실례: fixtures/map-dynamics.json');
  } else {
    console.log('매핑 없이 바로 흡수할 수 있습니다: node build.mjs ingest --src=<경로>');
  }
}

function cmdIngest() {
  const src = arg('src') || die('--src=<파일 또는 폴더> 가 필요합니다');
  if (!fs.existsSync(src)) die('없는 경로: ' + src);
  const outDir = arg('out') || 'ERD';
  const project = arg('project') || path.basename(path.resolve(src)).replace(/^_+/, '');
  const infer = argv.includes('--infer');

  const mapPath = arg('map');
  const map = mapPath ? JSON.parse(fs.readFileSync(mapPath, 'utf8')) : null;

  const { irs, skipped } = readAll(src, map);

  if (!irs.length) {
    console.error('읽을 수 있는 파일이 없습니다.');
    console.error('지원 형식: ' + READERS.flatMap(r => r.ext).join(' '));
    if (skipped.length) {
      console.error('건너뛴 파일 ' + skipped.length + '개:');
      skipped.slice(0, 10).forEach(f => console.error('  · ' + path.basename(f)));
      console.error('아직 판독기가 없는 형식입니다. 스킬에 맡기면 수동으로 분석합니다.');
    }
    process.exit(1);
  }

  const result = toDbml(irs, { infer, project });
  const rec = reconcile(irs, result);

  fs.mkdirSync(outDir, { recursive: true });
  const dbmlPath = path.join(outDir, 'schema.dbml');
  fs.writeFileSync(dbmlPath, result.dbml);
  fs.writeFileSync(path.join(outDir, 'report.md'), reportMd(irs, result, rec, { project }));

  console.log('읽음: ' + irs.map(i => i.source + ' (' + i.format + ')').join(', '));
  if (skipped.length) console.log('건너뜀: ' + skipped.length + '개 — 판독기 없는 형식');
  console.log('생성됨: ' + dbmlPath);
  console.log('        ' + path.join(outDir, 'report.md'));
  console.log('테이블 ' + result.tables.size + ' · 관계 ' + result.refs.length +
    ' · 그룹 ' + result.groups.size + (result.stubs.length ? ' · 스텁 ' + result.stubs.length : ''));
  console.log('');
  console.log('1:1 대조 — 원본 사실 ' + rec.sourceFacts + ' · 내보낸 Ref ' + rec.emitted);
  console.log('  빠짐 ' + rec.missing.length + ' · 창작 ' + rec.invented.length +
    ' · 근거없음 ' + rec.noEvidence.length);
  if (rec.droppedEstimates)
    console.log('  추정이라 제외 ' + rec.droppedEstimates + '건 (report.md 확인 목록 참조)');
  if (result.warnings.length) console.log('경고 ' + result.warnings.length + '건 — report.md 참조');
  console.log(rec.ok ? '대조 통과' : '대조 실패 — report.md 를 보세요');

  if (!rec.ok) { process.exitCode = 1; return; }
  console.log('');
  console.log('다음: node build.mjs build --dbml=' + dbmlPath);
}

switch (cmd) {
  case 'inspect': cmdInspect(); break;
  case 'ingest': cmdIngest(); break;
  case 'build': cmdBuild(); break;
  case 'check': cmdCheck(); break;
  case 'selftest': cmdSelftest(); break;
  default:
    console.log('사용: inspect | ingest | build | check | selftest');
    console.log('  node build.mjs inspect --src=_자료                       구조만 보고');
    console.log('  node build.mjs ingest --src=_자료 [--map=map.json] [--out=ERD] [--project=이름] [--infer]');
    console.log('  node build.mjs build --dbml=ERD/schema.dbml [--out=...] [--title="..."] [--overview=overview.json]');
    console.log('  node build.mjs check --dbml=ERD/schema.dbml');
    console.log('  node build.mjs selftest');
}
