#!/usr/bin/env node
/**
  * project-init — 기획 문서 표준 검증 + 단일 HTML 뷰어 빌더.
 *
 *   node build.mjs check                검증만 (실패 시 exit 1)
 *   node build.mjs check --deep         + 품질 점검 (경고만, 빌드는 막지 않음)
 *   node build.mjs build                검증 후 index.html 생성
 *   node build.mjs init --preset=<이름> --name="<프로젝트>"
 *   node build.mjs init --modules=<a,b,c> --name="<프로젝트>"
 *   node build.mjs intake               미처리 기획안 확인 (있으면 exit 0, 없으면 1)
 *   node build.mjs intake --archive=<파일>  처리 완료분 보관
 *   node build.mjs options [--json]     범위 옵션 카탈로그와 현재 선택
 *   node build.mjs presets              프리셋 목록
 *   node build.mjs modules              모듈 목록 (프리셋 없이 조합 가능)
 *   node build.mjs eval [--case=<이름>]  스킬 평가 (evals/RUBRIC.md 와 함께)
 *   node build.mjs selftest             파서·검증기 자체 점검
 *
 * 공통 옵션: --docs=<디렉터리>  (기본 ./Docs)
 *
 * 의존성 없음 (Node 18+).
 */

import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { execFileSync } from "node:child_process";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  escapeHtml,
  mdToHtml,
  normalizeSectionTitle,
  parseFrontmatter,
  scanReferences,
} from "./markdown.mjs";

const SKILL_DIR = dirname(fileURLToPath(import.meta.url));
const schema = JSON.parse(
  readFileSync(join(SKILL_DIR, "schema.json"), "utf8"),
);

const STATUS_LABEL = { draft: "초안", review: "검토중", approved: "확정" };
const TODO_LABEL = {
  client: "클라이언트",
  design: "디자인",
  copy: "카피",
  legal: "법무",
  dev: "개발",
};

/** 인라인 SVG 아이콘. 외부 폰트·라이브러리를 쓰지 않는다. */
const ICON = {
  panel:
    '<svg viewBox="0 0 16 16" width="15" height="15" aria-hidden="true">' +
    '<rect x="1.75" y="2.75" width="12.5" height="10.5" rx="2" fill="none" stroke="currentColor" stroke-width="1.3"/>' +
    '<line x1="6.25" y1="2.75" x2="6.25" y2="13.25" stroke="currentColor" stroke-width="1.3"/></svg>',
  wide:
    '<svg viewBox="0 0 16 16" width="15" height="15" aria-hidden="true">' +
    '<path d="M6.5 4.5 3 8l3.5 3.5M9.5 4.5 13 8l-3.5 3.5" fill="none" stroke="currentColor" ' +
    'stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  search:
    '<svg viewBox="0 0 16 16" width="13" height="13" aria-hidden="true">' +
    '<circle cx="7" cy="7" r="4.25" fill="none" stroke="currentColor" stroke-width="1.4"/>' +
    '<line x1="10.2" y1="10.2" x2="13.5" y2="13.5" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/></svg>',
};

const today = () => new Date().toISOString().slice(0, 10);
const nowMinute = () => {
  const d = new Date();
  const p = (n) => String(n).padStart(2, "0");
  return d.getFullYear() + "-" + p(d.getMonth() + 1) + "-" + p(d.getDate()) + " " + p(d.getHours()) + ":" + p(d.getMinutes());
};

const arg = (name, fallback = null) => {
  const hit = process.argv.find((a) => a.startsWith("--" + name + "="));
  return hit ? hit.slice(name.length + 3) : fallback;
};

/* ================================================================== *
 * 로드
 * ================================================================== */

function loadConfig(docsDir) {
  const path = join(docsDir, "docs.config.json");
  if (!existsSync(path)) return { project: "Project", preset: null };
  return JSON.parse(readFileSync(path, "utf8"));
}

function loadDocs(docsDir) {
  const files = readdirSync(docsDir)
    .filter((f) => f.endsWith(".md") && !f.startsWith("_"))
    .sort();

  return files
    .map((file) => {
      const raw = readFileSync(join(docsDir, file), "utf8");
      const { meta, body, found } = parseFrontmatter(raw);
      const sections = [];
      for (const line of body.split("\n")) {
        const h = line.match(/^##\s+(.*)$/);
        if (h) sections.push(normalizeSectionTitle(h[1]));
      }
      return {
        file,
        meta,
        body,
        hasFrontmatter: found,
        sections,
        refs: scanReferences(body),
        id: meta.id || file.replace(/\.md$/, ""),
      };
    })
    .sort((a, b) => a.id.localeCompare(b.id));
}

/**
 * 1단계(project-interview) 산출물을 읽는다.
 *
 * `Docs/_discovery/` 에 기획안과 인터뷰 기록이 쌓인다. 2단계 문서와 성격이 달라
 * 스키마 검증(필수 섹션·template·날짜 형식)을 적용하지 않는다. 대신 id 중복과
 * 위키링크만 검사하고, 추적 ID는 2단계와 같은 풀에서 관리한다.
 *
 * 메뉴는 분리된다 — 어느 단계에서 나온 기록인지 섞이면 안 된다.
 */
function loadStageDocs(docsDir, dirName, stage, prefix) {
  const dir = join(docsDir, dirName);
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => f.endsWith(".md") && !f.startsWith("."))
    .sort()
    .map((file) => {
      const raw = readFileSync(join(dir, file), "utf8");
      const { meta, body } = parseFrontmatter(raw);
      return {
        file: dirName + "/" + file,
        meta,
        body,
        stage,
        refs: scanReferences(body),
        id: meta.id || prefix + file.replace(/\.md$/, ""),
      };
    });
}

const loadDiscovery = (d) => loadStageDocs(d, DISCOVERY_DIR, 1, "discovery-");
const loadDesign = (d) => loadStageDocs(d, DESIGN_DIR, 3, "design-");
const loadBuild = (d) => loadStageDocs(d, BUILD_DIR, 4, "build-");

/** 3단계 스타일 가이드가 있으면 경로를 돌려준다. */
function findStyleguide(docsDir) {
  const rel = DESIGN_DIR + "/styleguide.html";
  return existsSync(join(docsDir, rel)) ? rel : null;
}

/** 3단계가 만든 시안 HTML 목록. 문서가 아니라 링크로 다룬다. */
function loadMockups(docsDir) {
  const dir = join(docsDir, DESIGN_DIR, MOCKUP_DIR);
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => /\.html?$/i.test(f))
    .sort()
    .map((f) => ({ file: f, href: DESIGN_DIR + "/" + MOCKUP_DIR + "/" + f }));
}

/* ================================================================== *
 * 연동 서비스
 *
 * 문서 바깥에 있는 것들(저장소·API 문서·협업 도구)이 어디에 붙어 있는지
 * 한곳에서 본다. 목록이 어디서 오는지는 네 갈래다. **아래일수록 약하다.**
 *
 *   1. 설정   `docs.config.json.integrations` — 사람이 적은 것. 언제나 이긴다
 *   2. 자동   깃 리모트 · 스펙 파일 — 빌드가 직접 본다
 *   3. 기획   문서 본문에서 잡은 **연동 예정** — 기획에 적혀 있으면 목록에 오른다
 *   4. 추천   1~3 이 **하나도 없을 때만** 카탈로그 기본값으로 채운다
 *
 * 3번이 이 체계의 요점이다. 연동은 기획에서 먼저 정해지고 나중에 붙는다.
 * 기획서에 "GCP 에 배포한다"고 적어 두었으면 그건 이미 연동 예정이다 —
 * 사람이 설정 파일에 한 번 더 적게 만들 이유가 없다.
 * ================================================================== */

/**
 * `detect` 는 문서 본문에서 찾을 표기다. 서비스 이름이 본문에 있으면 연동 예정으로 본다.
 * `recommend` 는 아무것도 못 잡았을 때 보여줄 기본 후보다.
 * 카탈로그에 없는 서비스도 설정에 적으면 그대로 나온다.
 */
const LINK_CATALOG = [
  { id: "github", name: "GitHub", slug: "github", color: "181717", what: "코드 저장소 · 이슈 · PR",
    recommend: true, detect: ["github", "깃허브"] },
  { id: "swagger", name: "Swagger", slug: "swagger", color: "85EA2D", what: "API 스펙 · 문서",
    recommend: true, detect: ["swagger", "openapi", "스웨거"] },
  { id: "notion", name: "Notion", slug: "notion", color: "000000", what: "회의록 · 업무 위키",
    recommend: true, detect: ["notion", "노션"] },
  { id: "figma", name: "Figma", slug: "figma", color: "F24E1E", what: "디자인 원본 · 시안",
    recommend: true, detect: ["figma", "피그마"] },
  { id: "slack", name: "Slack", slug: "slack", color: "4A154B", what: "알림 · 커뮤니케이션",
    recommend: true, detect: ["slack", "슬랙"] },
  { id: "jira", name: "Jira", slug: "jira", color: "0052CC", what: "이슈 · 스프린트",
    recommend: true, detect: ["jira", "지라"] },

  /* 아래는 추천 기본값이 아니다 — 기획에 적혀 있을 때만 올라온다 */
  { id: "gcp", name: "Google Cloud", slug: "googlecloud", color: "4285F4", what: "배포 · 호스팅",
    detect: ["gcp", "google cloud", "구글 클라우드", "cloud run", "app engine"] },
  { id: "aws", name: "AWS", slug: "amazonwebservices", color: "232F3E", what: "배포 · 호스팅",
    detect: ["aws", "amazon web services", "ec2", "s3 버킷"] },
  { id: "vercel", name: "Vercel", slug: "vercel", color: "000000", what: "배포 · 호스팅",
    detect: ["vercel", "버셀"] },
  { id: "cloudflare", name: "Cloudflare", slug: "cloudflare", color: "F38020", what: "CDN · DNS",
    detect: ["cloudflare", "클라우드플레어"] },
  { id: "ga4", name: "Google Analytics", slug: "googleanalytics", color: "E37400", what: "측정 · 전환 추적",
    detect: ["ga4", "google analytics", "구글 애널리틱스"] },
  { id: "gtm", name: "Google Tag Manager", slug: "googletagmanager", color: "246FDB", what: "태그 운영",
    detect: ["gtm", "google tag manager", "태그매니저", "태그 매니저"] },
  { id: "sentry", name: "Sentry", slug: "sentry", color: "362D59", what: "에러 추적",
    detect: ["sentry", "센트리"] },
  { id: "kakao", name: "카카오", slug: "kakaotalk", color: "FFCD00", what: "채널 · 알림톡",
    detect: ["카카오", "알림톡", "kakao"] },
  { id: "naver", name: "네이버", slug: "naver", color: "03C75A", what: "검색 등록 · 서치어드바이저",
    detect: ["서치어드바이저", "네이버 웹마스터", "naver search advisor"] },
  { id: "stripe", name: "Stripe", slug: "stripe", color: "635BFF", what: "결제",
    detect: ["stripe", "스트라이프"] },
  { id: "tosspayments", name: "토스페이먼츠", slug: "tosspayments", color: "0064FF", what: "결제",
    detect: ["토스페이먼츠", "tosspayments", "toss payments"] },
  { id: "firebase", name: "Firebase", slug: "firebase", color: "DD2C00", what: "인증 · 실시간 DB",
    detect: ["firebase", "파이어베이스"] },
  { id: "supabase", name: "Supabase", slug: "supabase", color: "3FCF8E", what: "DB · 인증",
    detect: ["supabase", "수파베이스"] },
  { id: "sendgrid", name: "SendGrid", slug: "sendgrid", color: "1A82E2", what: "메일 발송",
    detect: ["sendgrid", "센드그리드"] },
  { id: "githubactions", name: "GitHub Actions", slug: "githubactions", color: "2088FF", what: "CI · CD",
    detect: ["github actions", "깃허브 액션", "ci/cd"] },
];

/** git@host:a/b.git → https://host/a/b */
function normalizeRemote(url) {
  const ssh = url.match(/^git@([^:]+):(.+?)(\.git)?$/);
  if (ssh) return "https://" + ssh[1] + "/" + ssh[2];
  return url.replace(/\.git$/, "");
}

/** 프로젝트 루트에서 알아낼 수 있는 연동만 자동으로 집는다. */
function detectLinks(docsDir) {
  const root = dirname(resolve(docsDir));
  const found = {};

  try {
    const remote = execFileSync("git", ["-C", root, "remote", "get-url", "origin"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
    if (/github\.com/.test(remote)) found.github = { url: normalizeRemote(remote), note: "git origin" };
  } catch {}

  const specDirs = ["", "docs", "api", "openapi"];
  for (const d of specDirs) {
    const dir = d ? join(root, d) : root;
    if (!existsSync(dir)) continue;
    const hit = readdirSync(dir).find((f) => /^(openapi|swagger)\.(ya?ml|json)$/i.test(f));
    if (hit) {
      found.swagger = { url: (d ? "../" + d + "/" : "../") + hit, note: "스펙 파일 " + (d ? d + "/" : "") + hit };
      break;
    }
  }
  return found;
}

/**
 * 기획 문서 본문에서 **연동 예정**을 잡는다.
 *
 * 연동은 설정 파일보다 기획서에 먼저 적힌다 — "GCP 에 배포한다", "카카오 알림톡을 쓴다".
 * 그걸 사람이 설정에 한 번 더 옮겨 적게 만들 이유가 없으므로 본문에서 직접 읽는다.
 * 근거(어느 문서에서 잡았는지)를 함께 돌려주어 오탐을 눈으로 판단할 수 있게 한다.
 */
function detectPlannedLinks(docs) {
  const found = {};
  for (const c of LINK_CATALOG) {
    if (!c.detect || !c.detect.length) continue;
    for (const d of docs) {
      const body = authoredText(d.body || "");
      const hit = c.detect.find((k) => body.includes(k.toLowerCase()));
      if (!hit) continue;
      const title = (d.meta && d.meta.title) || d.id;
      found[c.id] = { planned: true, note: "기획에 언급됨 — " + title };
      break;
    }
  }
  return found;
}

/**
 * 사람이 **쓴** 본문만 남긴다.
 *
 * 빼는 것 세 가지. 전부 실제로 오탐을 냈다.
 *   - `> **작성 지침**` — 템플릿 지침에 서비스 이름이 예시로 들어 있다.
 *     같이 읽으면 **빈 새 프로젝트에서도 연동이 잡힌다**
 *   - 코드 블록 — 설정 예시에 서비스 id 가 들어 있다
 *   - 인라인 코드 — `openapi` 처럼 **식별자**를 가리키는 표기다.
 *     "openapi 파일을 찾는다"는 설명이지 "openapi 를 쓴다"가 아니다
 *
 * 지침과 식별자는 "이런 걸 적어라"이지 "이걸 쓴다"가 아니다.
 */
function authoredText(body) {
  return body
    .replace(/```[\s\S]*?```/g, "")
    .split("\n")
    .filter((line) => !/^\s*>/.test(line))
    .join("\n")
    .replace(/`[^`\n]*`/g, "")
    .toLowerCase();
}

/**
 * 설정 + 자동 감지 + 기획 감지를 합친다. **설정이 항상 이긴다.**
 * 셋 다 비면 카탈로그의 추천 기본값으로 채운다 — 빈 페이지를 보여주지 않기 위해서다.
 * 카탈로그에 없는 id도 설정에 적으면 그대로 나온다(name 은 직접 적는다).
 */
function loadLinks(docsDir, config, docs = []) {
  const conf = config.integrations || {};
  const auto = detectLinks(docsDir);
  const planned = detectPlannedLinks(docs);

  let ids = [...new Set([...Object.keys(conf), ...Object.keys(auto), ...Object.keys(planned)])];
  const recommended = ids.length === 0;
  if (recommended) ids = LINK_CATALOG.filter((c) => c.recommend).map((c) => c.id);

  return ids.map((id) => {
    const base = LINK_CATALOG.find((c) => c.id === id) || { id, name: id, slug: id, color: "6b7280", what: "" };
    const c = typeof conf[id] === "string" ? { url: conf[id] } : conf[id] || {};
    const merged = { ...base, ...(planned[id] || {}), ...(auto[id] || {}), ...c };
    merged.source = conf[id] ? "설정" : auto[id] ? "자동 감지" : planned[id] ? "기획" : "추천";
    merged.connected = merged.status ? merged.status === "connected" : Boolean(merged.url);
    merged.prompt = merged.connected
      ? merged.name + " 연동(" + (merged.url || "") + ")이 지금 제대로 물려 있는지 점검해줘. " +
        "끊겼거나 갱신이 필요한 부분을 알려주고, 바뀐 내용은 Docs/docs.config.json 의 integrations." + id +
        " 에 반영한 뒤 project-init build 를 다시 돌려줘."
      : "이 프로젝트를 " + merged.name + (merged.what ? "(" + merged.what + ")" : "") + "에 연동하고 싶어. " +
        "지금 프로젝트 상태와 이미 붙어 있는 연동을 먼저 확인하고, " + merged.name +
        " 연동에 필요한 준비물과 단계를 순서대로 알려줘. 연동이 끝나면 Docs/docs.config.json 의 integrations." + id +
        ' 에 url 과 status:"connected" 를 기록하고 project-init build 를 다시 돌려서 문서에 반영해줘.';
    return merged;
  });
}

const LINK_ADD_PROMPT =
  "연동하고 싶은 서비스가 하나 더 있어: (서비스 이름). 이 프로젝트에 어떻게 붙이면 되는지 알려주고, " +
  "Docs/docs.config.json 의 integrations 에 항목을 추가한 뒤 project-init build 를 다시 돌려줘.";

/** 로고 타일. CDN이 막힌 환경에서는 이니셜로 떨어진다. */
const linkLogo = (l) =>
  '<span class="logo" style="--brand:#' + l.color + '"><i>' + escapeHtml(l.name.charAt(0)) + "</i>" +
  '<img src="https://cdn.simpleicons.org/' + l.slug + "/" + l.color + '" alt="" loading="lazy" onerror="this.remove()"></span>';

/* ================================================================== *
 * 3단계 — 시안 스냅샷과 규칙 검증
 *
 * 이 단계의 실패 모드는 "사람이 잊는 것"이다. 수정 이력을 안 적고 시안만
 * 고치면 문서와 산출물이 조용히 어긋난다. 실제로 그렇게 어긋난 적이 있다.
 * 그래서 여기 있는 검사는 --deep 없이 **항상** 돈다.
 * ================================================================== */

/**
 * 시안이 바뀌었으면 이전 내용을 .history/ 에 남긴다.
 *
 * "바뀌기 전 값도 적는다"는 규칙만으로는 되돌릴 수 없다. 값은 적어도
 * 파일은 사라진다. 실제로 한 회차를 통째로 잃은 적이 있다.
 * HTML 텍스트라 용량이 사실상 문제되지 않는다.
 */
function snapshotMockups(docsDir) {
  const dir = join(docsDir, DESIGN_DIR, MOCKUP_DIR);
  if (!existsSync(dir)) return [];
  const hist = join(dir, HISTORY_DIR);
  const saved = [];

  for (const m of loadMockups(docsDir)) {
    const cur = readFileSync(join(dir, m.file), "utf8");
    const base = m.file.replace(/\.html?$/i, "");
    if (!existsSync(hist)) mkdirSync(hist, { recursive: true });

    const prior = readdirSync(hist)
      .filter((f) => f.startsWith(base + "-") && /\.html$/.test(f))
      .sort();

    // 직전 스냅샷과 같으면 남기지 않는다 — 빌드마다 쌓이면 쓸모없어진다
    if (prior.length) {
      const last = readFileSync(join(hist, prior[prior.length - 1]), "utf8");
      if (last === cur) continue;
    }
    const seq = String(prior.length + 1).padStart(3, "0");
    const out = base + "-" + seq + ".html";
    writeFileSync(join(hist, out), cur);
    saved.push(out);
  }
  return saved;
}

/** tokens.css 에 선언된 커스텀 속성 이름. */
function tokenNames(docsDir) {
  const f = join(docsDir, DESIGN_DIR, "tokens.css");
  if (!existsSync(f)) return [];
  const css = readFileSync(f, "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
  const root = css.match(/:root\s*\{([\s\S]*?)\}/);
  if (!root) return [];
  return [...root[1].matchAll(/(--[a-z0-9-]+)\s*:/gi)].map((m) => m[1]);
}

/**
 * 화면 정의서·인터랙션 문서가 정의한 상태 중 시안이 보여주지 않는 것.
 *
 * 스타일 가이드의 버튼 8상태만으로는 부족하다. 폼의 submitting·error,
 * 목록의 빈 상태는 화면에서 따로 그려야 하고, 안 그리면 구현 단계에서
 * 각자 지어낸다. 시안에 `data-state="error"` 처럼 표시해 두면 여기서 대조한다.
 */
const STATE_ALIASES = {
  loading: ["loading", "로딩", "처리 중", "처리중", "submitting"],
  success: ["success", "성공", "완료"],
  error: ["error", "오류", "에러"],
  empty: ["empty", "빈 상태", "빈상태"],
  disabled: ["disabled", "비활성"],
};

function stateCoverage(docs, docsDir, mockups) {
  const specs = docs.filter((d) => /screen-spec|interaction-motion/.test(d.id));
  if (!specs.length) return [];
  const text = specs.map((d) => d.body).join("\n").toLowerCase();

  const required = Object.keys(STATE_ALIASES).filter((k) =>
    STATE_ALIASES[k].some((a) => text.includes(a.toLowerCase())),
  );
  if (!required.length) return [];

  let shown = "";
  const sg = join(docsDir, DESIGN_DIR, "styleguide.html");
  if (existsSync(sg)) shown += readFileSync(sg, "utf8");
  for (const m of mockups) shown += readFileSync(join(docsDir, m.href), "utf8");

  const declared = new Set(
    [...shown.matchAll(/data-state\s*=\s*["']([a-z-]+)["']/gi)].map((m) => m[1].toLowerCase()),
  );
  return required.filter((k) => !declared.has(k));
}

/**
 * 3단계 규칙 검증. 경고로 낸다 — 빌드는 막지 않되 눈에는 보이게.
 */
function designReview(docsDir, design, mockups, docs) {
  const warnings = [];
  const add = (file, msg) => warnings.push({ file, msg });
  if (!mockups.length) return warnings;

  const logPath = join(docsDir, DESIGN_DIR, "change-log.md");
  const hasLog = existsSync(logPath);
  const log = hasLog ? readFileSync(logPath, "utf8") : "";
  if (!hasLog) add(DESIGN_DIR + "/", "시안이 있는데 change-log.md 가 없습니다");

  const logTime = hasLog ? statSync(logPath).mtimeMs : 0;

  for (const m of mockups) {
    const abs = join(docsDir, m.href);
    const html = readFileSync(abs, "utf8");

    if (!/href="\.\.\/tokens\.css"/.test(html)) {
      add(m.href, "tokens.css 를 링크하지 않습니다 — 토큰이 갈라집니다");
    }
    if (/lorem ipsum/i.test(html.replace(/<!--[\s\S]*?-->/g, ""))) {
      add(m.href, "Lorem ipsum 이 남아 있습니다");
    }

    // 시안이 수정 이력보다 최신이면 이력이 빠졌을 가능성이 크다
    if (hasLog && statSync(abs).mtimeMs > logTime + 60000) {
      add(m.href, "change-log.md 보다 최신입니다 — 수정 이력을 빠뜨렸을 수 있습니다");
    }

    // 시안에 적힌 차수가 이력에 없으면 둘이 어긋난 것이다
    const rev = html.match(/(\d+)\s*차\s*시안/);
    if (hasLog && rev && !log.includes(rev[0])) {
      add(m.href, '"' + rev[0] + '" 이 change-log.md 에 없습니다 — 차수와 이력이 어긋납니다');
    }
  }

  // 토큰이 규칙 문서에 하나도 언급되지 않으면 규칙과 값이 갈라진 상태다
  const rules = design.find((d) => /design-rules/.test(d.id));
  if (rules) {
    const missing = tokenNames(docsDir).filter((t) => !rules.body.includes(t));
    if (missing.length) {
      add(
        DESIGN_DIR + "/design-rules.md",
        "규칙에 언급되지 않은 토큰 " + missing.length + "개: " + missing.slice(0, 8).join(", "),
      );
    }
  }

  if (!existsSync(join(docsDir, DESIGN_DIR, "audit.html"))) {
    add(DESIGN_DIR + "/", "audit.html 이 없습니다 — 시안 검수를 손으로 하고 있다는 뜻입니다");
  }
  if (!existsSync(join(docsDir, DESIGN_DIR, "tone-options.html"))) {
    add(DESIGN_DIR + "/", "tone-options.html 이 없습니다 — 톤 방향을 확인받지 않고 시안을 만들었을 수 있습니다");
  }

  // 문서가 정의한 상태 중 시안에 없는 것
  const missing = stateCoverage(docs || [], docsDir, mockups);
  if (missing.length) {
    add(
      DESIGN_DIR + "/mockups/",
      "문서가 정의했으나 시안에 없는 상태: " + missing.join(", ") +
        ' — 해당 상태를 그리고 data-state="이름" 을 붙이세요',
    );
  }
  return warnings;
}

/**
 * 4단계 구현 검증.
 *
 * 이 단계의 위험은 3단계와 다르다 — **시안을 코드로 옮기면서 값이 흐트러지는 것**이다.
 * 클래스 이름이 바뀌면 눈으로 대조할 방법이 없으므로 표식과 대조기가 필요하다.
 */
function buildReview(docsDir, build, docs) {
  const warnings = [];
  const add = (file, msg) => warnings.push({ file, msg });
  const srcDir = join(docsDir, "..", "src");
  const hasSrc = existsSync(srcDir);
  if (!build.length && !hasSrc) return warnings;

  const has = (f) => existsSync(join(docsDir, BUILD_DIR, f));

  if (hasSrc && !has("parity.html")) {
    add(BUILD_DIR + "/", "parity.html 이 없습니다 — 구현이 시안과 어긋나도 알 방법이 없습니다");
  }
  if (hasSrc && !has("coverage.md")) {
    add(BUILD_DIR + "/", "coverage.md 가 없습니다 — 화면 정의서 대비 무엇을 만들었는지 기록이 없습니다");
  }
  if (hasSrc && !has("change-log.md")) {
    add(BUILD_DIR + "/", "구현이 있는데 change-log.md 가 없습니다");
  }

  // 토큰을 복사해 넣었는지 — 값이 두 곳이 되면 반드시 갈라진다
  if (hasSrc && existsSync(join(docsDir, DESIGN_DIR, "tokens.css"))) {
    const names = tokenNames(docsDir);
    const copied = [];
    const walk = (dir) => {
      let entries;
      try { entries = readdirSync(dir, { withFileTypes: true }); } catch (e) { return; }
      for (const e of entries) {
        if (e.name === "node_modules" || e.name.startsWith(".")) continue;
        const full = join(dir, e.name);
        if (e.isDirectory()) { walk(full); continue; }
        if (!/\.(css|ts|tsx|js|jsx)$/.test(e.name)) continue;
        const body = readFileSync(full, "utf8");
        for (const n of names) {
          const m = body.match(new RegExp(n + "\\s*:\\s*([^;]*);"));
          // var(...) 로 잇는 것은 정상. 값을 그대로 적었으면 복사다.
          if (m && !/var\(/.test(m[1])) { copied.push(e.name + " · " + n); break; }
        }
      }
    };
    walk(srcDir);
    if (copied.length) {
      add("src/", "tokens.css 값을 복사한 곳이 있습니다 — 링크하세요: " + copied.slice(0, 5).join(", "));
    }
  }

  // 수용 기준을 실제로 대고 있는가
  const prd = docs.find((d) => /prd/.test(d.id));
  const log = has("change-log.md")
    ? readFileSync(join(docsDir, BUILD_DIR, "change-log.md"), "utf8") : "";
  if (hasSrc && prd) {
    const unique = [...new Set([...prd.body.matchAll(/\bF-\d{2}\b/g)].map((m) => m[0]))];
    const untouched = unique.filter((id) => !log.includes(id));
    if (untouched.length) {
      add(
        BUILD_DIR + "/change-log.md",
        "구현 이력에 한 번도 언급되지 않은 수용 기준 " + untouched.length + "개: " +
          untouched.slice(0, 8).join(", "),
      );
    }
  }
  return warnings;
}

/**
 * 1·3단계 기록 검증.
 *
 * 스키마(필수 섹션·template·날짜 형식)는 면제하지만 **참조 무결성은 면제하지 않는다.**
 * 없는 문서로 링크하거나 정의되지 않은 추적 ID를 언급하는 것은
 * 어느 단계에서 일어나든 똑같이 깨진 것이다.
 */
function validateDiscovery(records, knownIds, definedIds) {
  const errors = [];
  const seen = new Set();
  for (const d of records) {
    if (seen.has(d.id)) {
      errors.push({ file: d.file, msg: "id 중복: " + d.id });
    }
    seen.add(d.id);
    for (const target of d.refs.wikiLinks) {
      if (!knownIds.has(target)) {
        errors.push({ file: d.file, msg: "깨진 참조: [[" + target + "]]" });
      }
    }
    if (definedIds) {
      for (const id of d.refs.mentioned) {
        if (!definedIds.has(id)) {
          errors.push({ file: d.file, msg: "정의되지 않은 추적 ID: " + id });
        }
      }
    }
  }
  return errors;
}

/* ================================================================== *
 * 검증
 * ================================================================== */

function validate(docs, extraIds = new Set()) {
  const errors = [];
  const warnings = [];
  const fail = (doc, msg) => errors.push({ file: doc.file, msg });
  const warn = (doc, msg) => warnings.push({ file: doc.file, msg });

  const byId = new Map();

  for (const doc of docs) {
    if (!doc.hasFrontmatter) {
      fail(doc, "프론트매터가 없습니다");
      continue;
    }

    for (const key of schema.frontmatter.required) {
      if (!doc.meta[key]) fail(doc, "프론트매터 누락: " + key);
    }

    for (const [key, allowed] of Object.entries(schema.frontmatter.enums)) {
      const v = doc.meta[key];
      if (v && !allowed.includes(v)) {
        fail(doc, key + " 값 오류: '" + v + "' (허용: " + allowed.join(", ") + ")");
      }
    }

    for (const [key, pattern] of Object.entries(schema.frontmatter.patterns)) {
      const v = doc.meta[key];
      if (v && !new RegExp(pattern).test(v)) {
        fail(doc, key + " 형식 오류: '" + v + "'");
      }
    }

    for (const [key, max] of Object.entries(schema.frontmatter.maxLength)) {
      const v = doc.meta[key];
      if (v && v.length > max) {
        fail(doc, key + " 길이 초과: " + v.length + "자 (최대 " + max + ")");
      }
    }

    if (schema.rules.filenameMatchesId && doc.meta.id) {
      const ok = doc.file === doc.meta.id + ".md" || doc.file === "README.md";
      if (!ok) fail(doc, "파일명이 id와 다릅니다: id=" + doc.meta.id);
    }

    if (schema.rules.uniqueIds && doc.meta.id) {
      if (byId.has(doc.meta.id)) {
        fail(doc, "id 중복: " + doc.meta.id + " (" + byId.get(doc.meta.id) + ")");
      } else {
        byId.set(doc.meta.id, doc.file);
      }
    }

    // 문서 종류별 필수 섹션
    const tmpl = schema.sectionsByTemplate[doc.meta.template];
    if (doc.meta.template && !tmpl) {
      fail(doc, "알 수 없는 template: " + doc.meta.template);
    } else if (tmpl) {
      for (const required of tmpl.required) {
        if (!doc.sections.includes(required)) {
          fail(doc, "필수 섹션 누락: " + required);
        }
      }
    }
  }

  const ids = new Set([...docs.map((d) => d.id), ...extraIds]);

  // 위키링크 해석
  if (schema.rules.wikiLinksResolve) {
    for (const doc of docs) {
      for (const target of doc.refs.wikiLinks) {
        if (!ids.has(target)) fail(doc, "깨진 참조: [[" + target + "]]");
      }
    }
  }

  // 추적 ID — 언급됐지만 어디에도 정의되지 않은 것
  const definedAnywhere = new Set();
  for (const doc of docs) for (const id of doc.refs.defined) definedAnywhere.add(id);

  if (schema.rules.referencedIdsMustBeDefined) {
    for (const doc of docs) {
      for (const id of doc.refs.mentioned) {
        if (!definedAnywhere.has(id)) {
          fail(doc, "정의되지 않은 추적 ID: " + id);
        }
      }
    }
  }

  // 문서 id를 맨텍스트로 참조 — 위키링크로 바꾸라는 경고
  if (schema.rules.warnOnPlainDocReference) {
    for (const doc of docs) {
      for (const other of ids) {
        if (other === doc.id) continue;
        const plain = new RegExp(
          "(?<!\\[\\[)(?<!/)\\b" + other + "\\b(?!\\]\\])(?!\\.md)",
        );
        if (plain.test(doc.body) && !doc.refs.wikiLinks.has(other)) {
          warn(doc, other + " 를 맨텍스트로 참조 — [[" + other + "]] 권장");
        }
      }
    }
  }

  return { errors, warnings };
}

/* ================================================================== *
 * 품질 점검 (check --deep)
 *
 * 스키마 검증이 "형식이 맞는가"를 본다면 이쪽은 "내용이 방치되지 않았는가"를 본다.
 * 기계가 확정할 수 없는 것은 **경고로만** 낸다 — 빌드를 막지 않는다.
 * 판단이 필요한 항목까지 실패로 처리하면 우회하려고 규칙을 느슨하게 만들게 된다.
 * ================================================================== */

/**
 * 사업 성과로 읽히는 수치만 잡는다.
 *
 * `200% 확대`(접근성 기준)나 `90% 스크롤`(이벤트 임계값)처럼 스펙 수치는
 * 잡지 않는다. 오탐이 쌓이면 점검 자체를 무시하게 된다.
 * 성과 문맥 낱말이 가까이 있을 때만 후보로 본다.
 */
const CLAIM_RE = /\d[\d,.]*\s*(?:만|천|억|조)?\s*(?:%|명|원|배|퍼센트)(?![a-zA-Z])/g;
const OUTCOME_WORDS =
  /(증가|감소|절감|개선|향상|성장|달성|상승|단축|절약|매출|수익|고객|사용자|가입|전환율|만족도|점유율|ROI|성공률|재구매|이탈률)/;

function outcomeClaims(text) {
  const out = new Set();
  for (const m of text.matchAll(CLAIM_RE)) {
    const from = Math.max(0, m.index - 24);
    const around = text.slice(from, m.index + m[0].length + 24);
    if (OUTCOME_WORDS.test(around)) out.add(m[0].trim());
  }
  return [...out];
}

function stripCode(md) {
  return md.replace(/```[\s\S]*?```/g, " ").replace(/`[^`\n]*`/g, " ");
}

function deepReview(docs, discovery, design, mockups, docsDir) {
  const notes = [];
  const add = (file, msg) => notes.push({ file, msg });
  const all = [...docs, ...discovery, ...design];

  for (const d of docs) {
    const body = stripCode(d.body);

    // 확정 문서에 대기 항목이 남아 있으면 확정이 아니다
    if (d.meta.status === "approved" && /TODO\([a-z]+\)/.test(body)) {
      add(d.file, "status가 approved인데 TODO가 남아 있습니다");
    }

    // 표만 있고 내용이 없는 섹션 — 템플릿 그대로인 상태
    const emptyTable = /\|\s*\|\s*\|\s*\|?\s*\n(?!\s*\|\s*-)/.test(d.body);
    if (emptyTable) add(d.file, "비어 있는 표가 있습니다 (템플릿 그대로일 수 있음)");

    // 작성 지침이 남아 있으면 아직 안 채운 섹션이다
    const hints = (d.body.match(/> \*\*작성 지침\*\*/g) || []).length;
    if (hints) add(d.file, "작성 지침이 " + hints + "곳 남아 있습니다 (미작성 섹션)");

    // 남은 자리표시자
    if (/\{\{[^}]+\}\}/.test(d.body)) add(d.file, "치환되지 않은 자리표시자가 있습니다");

    // 성과 주장으로 읽히는 수치 — 근거가 있는지 사람이 확인해야 한다
    const claims = outcomeClaims(body);
    if (claims.length) {
      add(d.file, "근거 확인 필요한 성과 수치: " + claims.slice(0, 6).join(", "));
    }

    // 아무도 참조하지 않고 아무 데도 링크하지 않는 문서
    if (!d.refs.wikiLinks.size) add(d.file, "다른 문서를 하나도 링크하지 않습니다");
  }

  // 안티패턴 목록이 비어 있으면 시안을 검증할 기준이 없다
  const ds = docs.find((d) => /design-system/.test(d.id));
  if (ds) {
    const sec = ds.body.split(/^##\s+/m).find((x) => /^\d*\.?\s*안티패턴/.test(x));
    if (sec && !/^\s*[-*]\s/m.test(sec)) {
      add(ds.file, "안티패턴 목록이 비어 있습니다 — 시안을 판정할 기준이 없습니다");
    }
  }

  // 3단계 시안 검사는 designReview 로 옮겼다 — --deep 없이 항상 돌아야 하는 것들이라서.
  if (mockups.length && !existsSync(join(docsDir, DESIGN_DIR, "tokens.css"))) {
    add(DESIGN_DIR + "/", "시안은 있는데 tokens.css가 없습니다");
  }

  // 오래 묵은 문서
  const today0 = today();
  for (const d of all) {
    const u = d.meta.updated || d.meta.date;
    if (!u || !/^\d{4}-\d{2}-\d{2}$/.test(u)) continue;
    const days = Math.round((Date.parse(today0) - Date.parse(u)) / 86400000);
    if (days > 90) add(d.file, days + "일간 갱신되지 않았습니다");
  }

  return notes;
}

/* ================================================================== *
 * 추적성 / 대시보드
 * ================================================================== */

function buildTraceability(docs) {
  const owners = new Map(); // id -> {doc, label}
  const refs = new Map(); // id -> Set<docId>
  const backlinks = new Map(); // docId -> Set<docId>

  for (const doc of docs) {
    for (const id of doc.refs.defined) {
      if (!owners.has(id)) owners.set(id, { doc: doc.id, label: labelFor(doc, id) });
    }
    for (const target of doc.refs.wikiLinks) {
      if (!backlinks.has(target)) backlinks.set(target, new Set());
      backlinks.get(target).add(doc.id);
    }
  }

  for (const doc of docs) {
    for (const id of doc.refs.mentioned) {
      if (doc.refs.defined.has(id)) continue;
      if (!refs.has(id)) refs.set(id, new Set());
      refs.get(id).add(doc.id);
    }
  }

  return { owners, refs, backlinks };
}

/** 추적 ID가 정의된 줄에서 사람이 읽을 라벨을 뽑는다. */
function labelFor(doc, id) {
  for (const line of doc.body.split("\n")) {
    if (!line.includes(id)) continue;
    const heading = line.match(/^#{2,6}\s+\**([A-Z]{1,3}-\d{1,3})\**\.?\s*(.*)$/);
    if (heading && heading[1] === id) {
      return heading[2].replace(/[*`]/g, "").trim();
    }
    const cells = line.split("|").map((c) => c.trim());
    if (cells.length > 2 && cells[1].replace(/[*`]/g, "") === id) {
      return cells[2].replace(/[*`]/g, "").trim();
    }
  }
  return "";
}

function collectTodos(docs) {
  const pattern = new RegExp(schema.traceability.todoPattern, "g");
  const groups = new Map();
  for (const doc of docs) {
    for (const m of doc.body.matchAll(pattern)) {
      const who = m[1];
      if (!groups.has(who)) groups.set(who, new Map());
      const g = groups.get(who);
      g.set(doc.id, (g.get(doc.id) || 0) + 1);
    }
  }
  return groups;
}

/**
 * 4단계 파이프라인의 현재 상태를 계산한다.
 * 3·4단계는 아직 스킬이 없으므로 자리만 잡아둔다 — GUIDE.md 를 고쳐 채운다.
 */
function stageStatus(docs, discovery, trace, design = [], mockups = [], styleguide = null,
                     build = [], docsDir = "") {
  const buildHas = (f) => !!docsDir && existsSync(join(docsDir, BUILD_DIR, f));
  const buildStarted = build.length > 0 || (!!docsDir && existsSync(join(docsDir, "..", "src")));
  const count = (st) => docs.filter((d) => d.meta.status === st).length;
  const blockers = [...trace.owners.keys()].filter((id) =>
    id.startsWith(schema.traceability.blockerPrefix + "-"),
  ).length;

  const s1 = discovery.length
    ? { mark: "완료", detail: "기록 " + discovery.length + "개" }
    : { mark: "미실행", detail: "기획안을 직접 넣었거나 아직 시작 전" };

  let s2;
  if (!docs.length) s2 = { mark: "미실행", detail: "" };
  else if (count("approved") === docs.length)
    s2 = { mark: "완료", detail: "문서 " + docs.length + "개 전부 확정" };
  else
    s2 = {
      mark: "진행 중",
      detail:
        "문서 " + docs.length + "개 — 확정 " + count("approved") +
        " · 검토중 " + count("review") + " · 초안 " + count("draft") +
        (blockers ? " · Blocker " + blockers + "건" : ""),
    };

  const rows = [
    ["1", "인터뷰", "`/project-interview`", s1],
    ["2", "구조화", "`/project-init`", s2],
    [
      "3", "디자인", "`/project-design`",
      design.length || mockups.length || styleguide
        ? {
            mark: mockups.length ? "진행 중" : "규칙 수립",
            detail:
              [
                design.length ? "기록 " + design.length + "개" : "",
                styleguide ? "스타일 가이드" : "",
                mockups.length ? "시안 " + mockups.length + "개" : "",
              ]
                .filter(Boolean)
                .join(" · "),
          }
        : { mark: "미실행", detail: "디자인 규칙과 시안이 아직 없음" },
    ],
    [
      "4", "구현", "`/project-build`",
      buildStarted
        ? {
            mark: "진행 중",
            detail: [
              buildHas("parity.html") ? "대조기" : "",
              buildHas("coverage.md") ? "커버리지" : "",
              build.length ? "기록 " + build.length + "개" : "",
            ].filter(Boolean).join(" · ") || "src 생성됨",
          }
        : { mark: "미실행", detail: "설계도와 시안을 코드로 옮기기 전" },
    ],
  ];

  const table =
    "| 단계 | 스킬 | 상태 | |\n| --- | --- | --- | --- |\n" +
    rows
      .map(
        ([n, name, cmd, st]) =>
          "| " + n + ". " + name + " | " + cmd +
          " | **" + st.mark + "** | " + st.detail + " |",
      )
      .join("\n");

  // 다음에 할 일 — 상태에서 유도한다
  let next;
  if (!docs.length) next = "먼저 `/project-interview` 로 기획안을 만드세요.";
  else if (count("approved") === docs.length)
    next = "문서가 모두 확정되었습니다. 3단계 디자인으로 넘어갈 수 있습니다.";
  else if (blockers)
    next =
      "**Blocker " + blockers + "건이 등록되어 있습니다.** 홈에서 목록을 확인하고, " +
      "해소되지 않은 것이 있다면 디자인·구현 단계로 넘어가기 전에 먼저 닫으세요.";
  else if (count("draft") > count("review") + count("approved"))
    next =
      "문서 대부분이 초안입니다. 기획안을 흡수하려면 `/project-init ingest`, " +
      "직접 채웠다면 `/project-init build` 로 갱신하세요.";
  else next = "검토가 끝난 문서는 `status` 를 `approved` 로 올리세요.";

  return { table, next: "> **다음에 할 일** — " + next };
}

/**
 * 4단계 진행률.
 *
 * 3단계와 같은 원칙 — 파일이 있으면 몇 점이 아니라, **수용 기준을 얼마나 통과했는가**로 센다.
 * 코드가 있다고 끝난 게 아니다. QA 체크리스트의 마지막 줄은 사용자 승인이고
 * 그건 AI 가 대신 체크하지 않는다.
 */
function stage4Progress(build, docs, docsDir) {
  if (!docsDir) return 0;
  const has = (f) => existsSync(join(docsDir, BUILD_DIR, f));
  const hasSrc = existsSync(join(docsDir, "..", "src"));
  if (!hasSrc && !build.length) return 0;

  let p = 0;
  if (hasSrc) p += 15;
  if (has("parity.html")) p += 10;
  if (has("coverage.md")) p += 10;
  const rules = build.find((d) => /build-rules/.test(d.id));
  if (rules) p += 10;

  // 수용 기준 **통과 비율**이 절반을 차지한다.
  // 이력에 이름이 나왔는지가 아니라 coverage.md 가 뭐라고 판정했는지를 센다 —
  // "언급됨"과 "통과함"은 다르다. 그 둘을 섞으면 진행률이 다시 거짓말을 한다.
  const prd = docs.find((d) => /prd/.test(d.id));
  const cov = has("coverage.md")
    ? readFileSync(join(docsDir, BUILD_DIR, "coverage.md"), "utf8") : "";
  if (prd && cov) {
    const ids = [...new Set([...prd.body.matchAll(/\bF-\d{2}\b/g)].map((m) => m[0]))];
    if (ids.length) {
      // 표의 **판정 칸만** 읽는다.
      //   · 줄 아무 데나 있는 ID 를 세면 "(F-03 준수)" 같은 언급이 잡힌다
      //   · 줄 아무 데나 있는 ✅ 를 세면 판정 근거 문장의 ✅ 가 🟡 을 이긴다
      // 둘 다 실제로 겪었다. 그래서 행 형식(| ID | 요구사항 | 판정 | 근거 |)을 고정해 읽는다.
      const verdict = (id) => {
        for (const line of cov.split("\n")) {
          if (!line.trim().startsWith("|")) continue;
          const cells = line.split("|");
          if (cells.length < 4) continue;
          if (!new RegExp("\\b" + id + "\\b").test(cells[1])) continue;
          const v = cells[3];
          if (v.includes("✅")) return 1;
          if (v.includes("🟡")) return 0.5;
          return 0;
        }
        return null;
      };
      let score = 0;
      for (const id of ids) {
        const v = verdict(id);
        if (v !== null) score += v;
      }
      p += Math.round((score / ids.length) * 45);
    }
  }
  // 나머지 10 은 사용자 최종 승인. build-rules 의 status 로 받는다.
  if (rules && rules.meta.status === "approved") p += 10;
  return Math.min(p, 100);
}

/**
 * 3단계 진행률.
 *
 * 예전에는 "파일이 있으면 몇 점" 이었다. 그래서 첫 시안을 만든 순간 100% 가 됐고,
 * 그 뒤로 열세 번을 더 고쳤다. 진행률이 아무것도 뜻하지 않았다.
 * 승인 전에는 100% 가 되지 않게 한다 — 남은 20% 가 곧 "사용자 확인" 이다.
 */
function stage3Progress(design, mockups, styleguide, docsDir) {
  const rules = design.find((d) => /design-rules/.test(d.id));
  const has = (f) => existsSync(join(docsDir, DESIGN_DIR, f));
  let p = 0;
  if (rules) p += 20;
  if (styleguide) p += 15;
  if (has("tone-options.html")) p += 10;
  if (has("audit.html")) p += 10;
  if (mockups.length) p += 25;
  // 승인은 사람만 줄 수 있다. design-rules.md 프론트매터의 status 로 받는다.
  if (rules && rules.meta.status === "approved") p += 20;
  else if (rules && rules.meta.status === "review") p += 8;
  return p;
}

function stageProgress(docs, discovery, design, mockups, styleguide, config, docsDir = "", build = []) {
  const clamp = (n) => Math.max(0, Math.min(100, Math.round(n)));
  const s2 = docs.length
    ? docs.reduce((sum, d) => sum + ({ draft: 25, review: 65, approved: 100 }[d.meta.status] || 0), 0) / docs.length
    : 0;
  const automatic = {
    1: discovery.length ? 100 : 0,
    2: s2,
    3: stage3Progress(design, mockups, styleguide, docsDir),
    4: stage4Progress(build, docs, docsDir),
  };
  const configured = config.stageProgress || {};
  return Object.fromEntries([1, 2, 3, 4].map((n) => [n, clamp(configured[n] ?? automatic[n])]));
}

function progressClass(percent) {
  if (percent <= 0) return "p-gray";
  if (percent < 25) return "p-red";
  if (percent < 50) return "p-yellow";
  if (percent < 100) return "p-orange";
  return "p-green";
}

/* ================================================================== *
 * 렌더
 * ================================================================== */

/**
 * 이 문서가 프로젝트에서 실제로 쓰였는가.
 *
 * 기획안을 근거로 메뉴는 만들어졌지만 끝까지 손대지 않는 문서가 생긴다.
 * 그런 문서를 "작성 중"으로 두면 진행률이 영원히 낮게 깔리고, 무엇이 남은
 * 일이고 무엇이 애초에 필요 없던 항목인지 구분되지 않는다.
 *
 * 판정은 네 신호 중 하나라도 걸리면 '쓰임'이다. 실측하면 갓 만든 문서는
 * 37~265, 한 번이라도 채운 문서는 996 이상으로 갈라진다.
 */
const USAGE_MIN_CHARS = 400;

function docUsed(doc) {
  // 주 신호는 **내용**이다. 상태나 링크는 템플릿이 만들어 낸 흔적일 수 있다:
  // log 템플릿은 status 가 approved 로 시작하고, 모든 spec 템플릿은 리스크
  // 대장으로 가는 링크를 자동으로 건다. 그걸 근거로 삼으면 갓 만든 대장이
  // 늘 '사용됨'이 된다.
  if (meaningfulChars(doc.body) >= USAGE_MIN_CHARS) return true;

  // 내용이 적어도 사람이 손댄 흔적이 있으면 사용으로 본다
  if (doc.meta.template !== "log" && doc.meta.status && doc.meta.status !== "draft") {
    return true;
  }
  const outside = stripCode(doc.body || "");           // 템플릿 예시 ID 는 제외
  for (const id of doc.refs?.defined || []) {
    if (outside.includes(id)) return true;
  }
  return false;
}

/** 템플릿 골격(제목·지침·빈 표·TODO)을 뺀 실질 글자 수. */
function meaningfulChars(body = "") {
  return body
    .replace(/^---\n[\s\S]*?\n---\n/, "")
    .replace(/^#{1,4} .*$/gm, "")
    .replace(/^\|[\s|:-]*\|\s*$/gm, "")
    .replace(/TODO\([a-z]+\)/g, "")
    .replace(/^> .*$/gm, "")
    .replace(/\|\s*\|/g, "")
    .replace(/[\s|·—▪•\-*`>]+/g, "").length;
}

function render(docs, config, trace, discovery = [], design = [], mockups = [], styleguide = null, docsDir = "", build = [], links = []) {
  const byId = new Map([...discovery, ...design, ...docs].map((d) => [d.id, d]));
  const resolveLink = (target) => {
    const d = byId.get(target);
    return d ? { id: d.id, title: d.meta.title || d.id } : null;
  };

  const phases = [];
  const progress = stageProgress(docs, discovery, design, mockups, styleguide, config, docsDir, build);
  const stageTitle = (n, label) =>
    '<div class="nav-group-title"><span>' + n + '단계 · ' + label + '</span><span class="nav-progress ' +
    progressClass(progress[n]) + '">' + progress[n] + '%</span></div>';
  for (const d of docs) {
    const phase = d.meta.phase || "기타";
    let g = phases.find((p) => p.name === phase);
    if (!g) phases.push((g = { name: phase, docs: [] }));
    g.docs.push(d);
  }

  const navLink = (id, label, status, used) =>
    '<a class="nav-item' +
    (used === false ? " unused" : "") +
    '" data-id="' +
    id +
    (used === undefined ? "" : '" data-used="' + (used ? "1" : "0")) +
    '" href="#/' +
    id +
    '"><span class="nav-dot s-' +
    status +
    '"></span><span class="nav-label">' +
    escapeHtml(label) +
    "</span></a>";

  const guidePath = join(SKILL_DIR, "GUIDE.md");
  let guideArticle = "";
  let guideNav = "";
  if (existsSync(guidePath)) {
    const st = stageStatus(docs, discovery, trace, design, mockups, styleguide, build, docsDir);
    const md = readFileSync(guidePath, "utf8")
      .replace("{{stage_status}}", st.table)
      .replace("{{next_action}}", st.next);
    const { html, headings } = mdToHtml(md, { resolveLink });
    const gh2 = headings.filter((h) => h.level === 2);
    const toc = gh2.length
      ? '<aside class="toc"><div class="toc-title">이 문서에서</div>' +
        gh2
          .map(
            (h) =>
              '<a href="#' + h.id + '" data-anchor="' + h.id + '">' +
              escapeHtml(h.text) + "</a>",
          )
          .join("") +
        "</aside>"
      : "";
    guideArticle =
      '<article class="doc doc-guide" data-id="__guide" data-title="가이드">' +
      '<div class="doc-inner"><div class="doc-body">' + html + "</div>" + toc +
      "</div></article>";
    guideNav = navLink("__guide", "가이드", "utility");
  }

  const mockupArticle = mockups.length
    ? '<article class="doc" data-id="__mockups" data-title="디자인 시안">' +
      '<div class="doc-inner"><div class="doc-body"><h1>디자인 시안</h1>' +
      '<p class="home-lead">3단계에서 만든 화면 시안입니다. 새 탭에서 열립니다. ' +
      "규칙과 수정 이력은 왼쪽 <strong>3단계 · 디자인</strong> 메뉴에 있습니다." +
      (styleguide
        ? ' 토큰 견본과 명도비는 <a href="' + styleguide + '" target="_blank" rel="noreferrer">스타일 가이드</a>에서 볼 수 있습니다.'
        : "") +
      "</p>" +
      '<div class="mockups">' +
      mockups
        .map(
          (m) =>
            '<a class="mockup" href="' + m.href + '" target="_blank" rel="noreferrer">' +
            '<span class="mockup-name">' + escapeHtml(m.file.replace(/\.html?$/i, "")) + "</span>" +
            '<span class="mockup-go">열기 ↗</span></a>',
        )
        .join("") +
      "</div></div></div></article>"
    : "";

  const sgLink = styleguide
    ? '<a class="nav-item nav-ext" href="' + styleguide + '" target="_blank" rel="noreferrer">' +
      '<span class="nav-dot s-stage3"></span><span>스타일 가이드 ↗</span></a>'
    : "";

  const designNav =
    '<div class="nav-group nav-stage3 ' + progressClass(progress[3]) + '">' + stageTitle(3, "디자인") +
      (design.length || mockups.length || styleguide ?
      sgLink +
      (mockups.length ? navLink("__mockups", "디자인 시안 " + mockups.length + "개", "stage3") : "") +
      design.map((d) => navLink(d.id, d.meta.title || d.id, "stage3")).join("") :
      '<div class="nav-empty">아직 산출물 없음</div>') + "</div>";

  const discoveryNav =
    '<div class="nav-group nav-stage1 ' + progressClass(progress[1]) + '">' + stageTitle(1, "인터뷰") +
      (discovery.length ?
      discovery
        .map((d) => navLink(d.id, d.meta.title || d.id, "stage1"))
        .join("") : '<div class="nav-empty">아직 산출물 없음</div>') + "</div>";

  const sidebar = '<div class="nav-group nav-stage2 ' + progressClass(progress[2]) + '">' + stageTitle(2, "구조화") + phases
    .map(
      (p) =>
        '<div class="nav-subgroup"><div class="nav-subgroup-title">' +
        escapeHtml(p.name) +
        "</div>" +
        p.docs
          .map((d) =>
            navLink(d.id, d.meta.title || d.id, d.meta.status || "draft", docUsed(d)),
          )
          .join("") +
        "</div>",
    )
    .join("") + "</div>";
  const implementationNav = '<div class="nav-group nav-stage4 ' + progressClass(progress[4]) + '">' +
    stageTitle(4, "구현") + '<div class="nav-empty">' +
    (progress[4] ? "구현 진행 중" : "아직 산출물 없음") + "</div></div>";


  /* --- 연동 서비스 --- */
  /* 좌측에는 **관리 메뉴 하나만** 둔다.
     서비스를 전부 나열하면 문서 메뉴보다 길어져 사이드바가 연동 목록판이 된다.
     목록은 연동 서비스 페이지가 맡는다. 여기서는 몇 개가 붙었는지만 보여준다. */
  const linkedCount = links.filter((l) => l.connected).length;
  const linksNav =
    '<div class="nav-group nav-links">' +
    '<a class="nav-item" data-id="__links" href="#/__links">' +
    '<span class="nav-dot s-utility"></span><span>연동 서비스 관리</span><span class="nav-progress ' +
    progressClass(links.length ? Math.round((linkedCount / links.length) * 100) : 0) + '">' +
    linkedCount + "/" + links.length + "</span></a>" +
    "</div>";

  const SRC_PILL = { "설정": "s-approved", "자동 감지": "s-review", "기획": "s-review", "추천": "s-draft" };
  const linkCard = (l) =>
    '<div class="link-card' + (l.connected ? " on" : "") + '">' +
    '<div class="link-head">' + linkLogo(l) +
    '<span class="link-name">' + escapeHtml(l.name) + "</span>" +
    '<span class="pill ' + (SRC_PILL[l.source] || "s-draft") + '">' + escapeHtml(l.source || "") + "</span>" +
    '<span class="pill ' + (l.connected ? "s-approved" : "s-draft") + '">' +
    (l.connected ? "연결됨" : "미연동") + "</span></div>" +
    '<p class="card-summary">' + escapeHtml(l.what || "") +
    (l.note ? " — " + escapeHtml(l.note) : "") + "</p>" +
    (l.url ? '<div class="link-url">' + escapeHtml(l.url) + "</div>" : "") +
    '<div class="link-actions">' +
    (l.connected && l.url
      ? '<a class="link-btn primary" href="' + escapeHtml(l.url) + '" target="_blank" rel="noreferrer">열기 ↗</a>'
      : "") +
    '<button class="link-btn" type="button" data-copy="' + escapeHtml(l.prompt) + '">' +
    (l.connected ? "점검 요청 복사" : "연동 방법 묻기 복사") + "</button></div></div>";

  const linksArticle =
    '<article class="doc" data-id="__links" data-title="연동 서비스"><div class="doc-inner"><div class="doc-body">' +
    "<h1>연동 서비스</h1>" +
    '<p class="home-lead">이 프로젝트가 밖으로 물려 있는 곳들입니다. ' +
    "연결된 카드는 눌러서 바로 이동하고, 아직 안 붙은 카드는 <strong>연동 방법 묻기</strong>를 눌러 " +
    "문구를 복사한 뒤 AI에게 그대로 물어보면 됩니다.</p>" +
    (links.every((l) => l.source === "추천")
      ? '<p class="home-lead links-hint"><strong>아직 정해진 연동이 없어 추천 목록을 보여줍니다.</strong> ' +
        "기획 문서에 쓸 서비스를 적으면(예: “GCP 에 배포한다”) 다음 빌드부터 이 자리에 그것이 올라옵니다. " +
        "확정된 것은 <code>Docs/docs.config.json</code> 의 <code>integrations</code> 에 적습니다.</p>"
      : '<p class="home-lead links-hint">목록은 <strong>설정 → 자동 감지 → 기획 본문</strong> 순으로 모읍니다. ' +
        "<code>기획</code> 딱지가 붙은 카드는 문서에 언급되어 자동으로 올라온 것이라 " +
        "오탐일 수 있습니다 — 아니면 <code>integrations</code> 에서 빼면 됩니다.</p>") +
    '<div class="links-grid">' +
    links.map(linkCard).join("") +
    '<div class="link-card link-add"><div class="link-head"><span class="logo logo-add"><i>+</i></span>' +
    '<span class="link-name">새 서비스 추가</span></div>' +
    '<p class="card-summary">카탈로그에 없는 서비스도 붙일 수 있습니다.</p>' +
    '<div class="link-actions"><button class="link-btn" type="button" data-copy="' +
    escapeHtml(LINK_ADD_PROMPT) + '">추가 문의 문구 복사</button></div></div>' +
    "</div></div></div></article>";

  /* 산출물 대본.
 *
 * 코드가 아니라 **AI 에게 주는 지시문**이다. 복사해서 에이전트에 붙여 넣으면
 * 그 형식으로 산출물을 만든다.
 *
 * 대본은 네 겹으로 쌓인다:
 *   _shape   문서 종류별 구성 — 이 문서는 무엇을 앞에 세워야 하는가
 *   _purpose 목적 블록 — 받는 사람이 첫 화면에서 무엇을 알아야 하는가
 *   _scope   고객 송부용 정제 — 무엇을 빼는가
 *   _style   시각 규격 — 색·글자·표. 값이 고정이라 매번 같은 모양이 나온다
 *
 * 대본은 원본 .md 경로만 가리킨다. 내용을 품지 않으므로 문서를 고친 뒤 같은
 * 대본을 다시 쓰면 최신 내용으로 만들어진다. HTML 크기도 문서 수와 무관하다. */
const SCRIPT_FORMATS = [
  { id: "pdf",   label: "PDF",               ext: "pdf" },
  { id: "excel", label: "Excel (XLSX)",      ext: "xlsx" },
  { id: "pptx",  label: "PowerPoint (PPTX)", ext: "pptx" },
  { id: "docx",  label: "Word (DOCX)",       ext: "docx" },
  { id: "csv",   label: "CSV",               ext: "csv" },
];

/* 문서 종류별 구성 지침.
 *
 * 같은 서식이어도 산출물의 뼈대는 문서마다 다르다. 일정표는 기간이 보여야 하고
 * 요구사항 대장은 무엇이 어디로 이어지는지가 보여야 한다. 이 지침이 없으면
 * "원본 순서대로 옮긴 파일"이 나오고, 받는 사람은 무엇을 보라는 것인지 모른다.
 *
 * 키는 문서 name(모듈에 적힌 것)이다. 없으면 기본 지침을 쓴다. */
const DOC_SHAPE = {
  "deliverable-register":
    "이 문서는 **납품 목록**입니다. 공정별로 묶고, 각 산출물의 `필수 여부`·" +
    "`고객 공유`·`상태`가 한눈에 보이게 하세요. 맨 앞 수치는 `전체 종수`, " +
    "`필수`, `작성 완료`, `미착수` 입니다. **제외한 산출물** 목록을 빠뜨리지 " +
    "마세요 — 고객이 '이건 왜 없냐'고 묻는 지점입니다. 버전 이력은 맨 뒤에 둡니다.",
  "wbs-schedule":
    "이 문서는 **일정표**입니다. 공정 → 과업 2단으로 묶고, 각 과업의 시작·종료·" +
    "담당·진척이 한 행에 보이게 하세요. 맨 앞 수치는 `전체 과업`, `종합 진척률`, " +
    "`진행 중`, `지연` 입니다. **마일스톤은 본표와 분리해 따로 세우세요** — " +
    "고객이 가장 먼저 보는 것이 보고·승인 시점입니다. 지연 과업은 굵게 표시합니다.",
  requirements:
    "이 문서는 **요구사항 추적표**입니다. 각 요구사항이 `어느 과업`으로 가고 " +
    "`어느 산출물`로 확인되는지가 같은 행에 보여야 합니다. 맨 앞 수치는 " +
    "`전체 요구사항`, `수용`, `추가 검토`, `미수용` 입니다. 부서별로 묶으면 " +
    "현업이 자기 것을 찾기 쉽습니다. **수용하지 않은 요구사항과 그 이유**를 " +
    "반드시 포함하세요.",
  "project-brief":
    "이 문서는 **사업 개요**입니다. 목표와 범위가 먼저이고, 특히 `범위 제외`를 " +
    "분명히 세우세요. 맨 앞 수치는 `목표 수`, `기간`, `이해관계자 수` 입니다. " +
    "이해관계자는 이름과 역할만 남기고 연락처는 뺍니다.",
  "screen-spec":
    "이 문서는 **화면 설계서**입니다. 화면 목록을 먼저 보여주고, 그 뒤에 화면별 " +
    "상세를 둡니다. 맨 앞 수치는 `전체 화면 수`와 구분별 개수입니다. " +
    "화면마다 **무엇을 하는 화면인지 한 줄**을 앞에 붙이세요.",
  "data-model":
    "이 문서는 **데이터 구조**입니다. 테이블 목록을 먼저, 그 뒤 테이블별 칼럼. " +
    "맨 앞 수치는 `테이블 수`, `관계 수` 입니다. 고객이 읽을 것이므로 " +
    "**한글 논리명을 물리명보다 앞에** 두세요.",
  "qa-test-plan":
    "이 문서는 **검증 계획**입니다. 무엇을 어떤 기준으로 통과시키는지가 핵심입니다. " +
    "맨 앞 수치는 `시나리오 수`, `필수 통과 항목`, `일정` 입니다. " +
    "고객이 직접 하는 확인(UAT)과 우리가 하는 확인을 **구분해서** 세우세요.",
  "release-ops":
    "이 문서는 **오픈·운영 안내**입니다. 오픈 절차와 이후 지원 체계가 핵심입니다. " +
    "맨 앞 수치는 `오픈 예정일`, `교육 대상 인원`, `지원 기간` 입니다. " +
    "고객이 해야 할 준비를 따로 묶어 세우세요.",
};

const DOC_SHAPE_DEFAULT =
  "원본의 절 구성을 따르되, **결론과 전체 그림을 앞으로 올리세요.** " +
  "표가 여러 개면 가장 중요한 것 하나를 먼저 세우고 나머지를 뒤로 보냅니다. " +
  "무엇이 가장 중요한지 판단이 안 서면, 행 수가 가장 많은 표가 보통 본표입니다.";

function loadScripts(project) {
  const dir = join(SKILL_DIR, "templates", "script");
  const part = (name) => {
    const path = join(dir, name + ".md");
    return existsSync(path) ? readFileSync(path, "utf8").trim() : "";
  };
  const style = part("_style");
  if (!style) return null;
  const purpose = part("_purpose");
  const scope = part("_scope");
  const out = {};
  for (const f of SCRIPT_FORMATS) {
    const path = join(dir, f.id + ".md");
    if (!existsSync(path)) continue;
    out[f.id] = readFileSync(path, "utf8")
      .replace("__STYLE__", style)
      .replace("__PURPOSE__", purpose)
      .replace("__SCOPE__", scope)
      .split("__PROJECT__").join(project || "이");
  }
  return Object.keys(out).length ? out : null;
}

/** 문서 id(`07-screen-spec`)에서 구성 지침을 찾는다. */
function docShape(id = "") {
  const name = id.replace(/^\d+-/, "");
  return "## 이 문서의 구성\n\n" + (DOC_SHAPE[name] || DOC_SHAPE_DEFAULT);
}


/* --- 문서 본문 (1단계 기록 + 2단계 문서) --- */
  const scripts = loadScripts(config.project);
  const searchIndex = [];
  const articles = [...discovery, ...design, ...docs]
    .map((d) => {
      const { html, headings, blocks } = mdToHtml(d.body, { resolveLink, dateToggles: true });
      for (const b of blocks) {
        searchIndex.push({
          d: d.id,
          n: d.meta.title || d.id,
          a: b.anchor,
          h: b.heading,
          t: b.text,
        });
      }
      const h2s = headings.filter((h) => h.level === 2);
      const toc = h2s.length
        ? '<aside class="toc"><div class="toc-title">이 문서에서</div>' +
          headings
            .map(
              (h) =>
                '<a href="#' +
                h.id +
                '" data-anchor="' +
                h.id +
                '">' +
                escapeHtml(h.text) +
                "</a>",
            )
            .join("") +
          "</aside>"
        : "";

      const back = trace.backlinks.get(d.id);
      const backHtml =
        back && back.size
          ? '<div class="backlinks"><div class="backlinks-title">이 문서를 참조하는 문서</div>' +
            [...back]
              .sort()
              .map(
                (src) =>
                  '<a href="#/' +
                  src +
                  '">' +
                  escapeHtml(byId.get(src)?.meta.title || src) +
                  "</a>",
              )
              .join("") +
            "</div>"
          : "";

      const defined = [...d.refs.defined].sort();
      const definedHtml = defined.length
        ? '<div class="idchips"><span class="idchips-title">이 문서가 정의한 ID</span>' +
          defined.map((id) => '<span class="chip">' + id + "</span>").join("") +
          "</div>"
        : "";

      const st = d.stage;
      const status = st ? "stage" + st : d.meta.status || "draft";
      const statusText = st ? st + "단계" : STATUS_LABEL[status] || status;
      const stage1 = !!st;
      return (
        '<article class="doc" data-id="' +
        d.id +
        '" data-title="' +
        escapeHtml(d.meta.title || d.id) +
        '"><div class="doc-inner"><div class="doc-body">' +
        '<div class="doc-meta"><span class="pill s-' +
        status +
        '">' +
        statusText +
        "</span>" +
        (stage1
          ? ""
          : '<span class="meta-sep"></span><span>담당 ' +
            escapeHtml(d.meta.owner || "—") +
            "</span>") +
        '<span class="meta-sep"></span><span>수정 ' +
        escapeHtml(d.meta.updated || d.meta.date || "—") +
        '</span><span class="meta-sep"></span><span class="mono">' +
        escapeHtml(d.file) +
        "</span>" +
        (stage1
          ? ""
          : '<button class="doc-export" type="button" data-export-file="' +
            escapeHtml(d.file) +
            '" data-export-title="' +
            escapeHtml(d.meta.title || d.id) +
            '" data-export-id="' +
            escapeHtml(d.id) +
            '">파일 스크립트</button>') +
        "</div>" +
        html +
        definedHtml +
        backHtml +
        "</div>" +
        toc +
        "</div></article>"
      );
    })
    .join("\n");

  /* --- 홈 대시보드 --- */
  const blockerPrefix = schema.traceability.blockerPrefix;
  const blockers = [...trace.owners.entries()]
    .filter(([id]) => id.startsWith(blockerPrefix + "-"))
    .sort();

  const blockerPanel = blockers.length
    ? '<div class="panel panel-alert"><div class="panel-title">Blocker ' +
      blockers.length +
      "건 — 해소 전 다음 단계 진입 불가</div>" +
      blockers
        .map(
          ([id, info]) =>
            '<a class="panel-row" href="#/' +
            info.doc +
            '"><span class="chip chip-alert">' +
            id +
            "</span><span>" +
            escapeHtml(info.label || "") +
            "</span></a>",
        )
        .join("") +
      "</div>"
    : "";

  const stage1Panel = discovery.length
    ? '<div class="panel panel-stage1"><div class="panel-title">1단계 · 기획 기록</div>' +
      discovery
        .map(
          (d) =>
            '<a class="panel-row" href="#/' +
            d.id +
            '"><span class="chip chip-stage1">1단계</span><span>' +
            escapeHtml(d.meta.title || d.id) +
            (d.meta.summary ? " — " + escapeHtml(d.meta.summary) : "") +
            "</span></a>",
        )
        .join("") +
      "</div>"
    : '<div class="panel"><div class="panel-title">1단계 · 기획 기록</div>' +
      '<div class="panel-row"><span class="muted">아직 없습니다. ' +
      "인터뷰로 기획안을 만들려면 project-interview 스킬을 실행하세요.</span></div></div>";

  const stage3Panel = design.length || mockups.length || styleguide
    ? '<div class="panel panel-stage3"><div class="panel-title">3단계 · 디자인</div>' +
      (styleguide
        ? '<a class="panel-row" href="' + styleguide + '" target="_blank" rel="noreferrer">' +
          '<span class="chip chip-stage3">가이드</span>' +
          "<span>스타일 가이드 — 토큰·명도비·상태를 실제로 렌더해 봅니다 ↗</span></a>"
        : "") +
      (mockups.length
        ? '<a class="panel-row" href="#/__mockups"><span class="chip chip-stage3">시안</span>' +
          "<span>" + mockups.length + "개 — 새 탭에서 열어볼 수 있습니다</span></a>"
        : "") +
      design
        .map(
          (d) =>
            '<a class="panel-row" href="#/' + d.id +
            '"><span class="chip chip-stage3">3단계</span><span>' +
            escapeHtml(d.meta.title || d.id) + "</span></a>",
        )
        .join("") +
      "</div>"
    : "";

  const scopePanel = config.options
    ? '<div class="panel"><div class="panel-title">이 프로젝트의 범위</div>' +
      '<div class="scope">' +
      Object.entries(config.options)
        .map(
          ([id, on]) =>
            '<span class="scope-item ' +
            (on ? "on" : "off") +
            '">' +
            escapeHtml(id) +
            "</span>",
        )
        .join("") +
      "</div></div>"
    : "";

  const todos = collectTodos(docs);
  const todoPanel = todos.size
    ? '<div class="panel"><div class="panel-title">대기 중인 정보 제공</div>' +
      [...todos.entries()]
        .sort()
        .map(([who, docsMap]) => {
          const total = [...docsMap.values()].reduce((a, b) => a + b, 0);
          return (
            '<div class="panel-row"><span class="chip">' +
            escapeHtml(TODO_LABEL[who] || who) +
            '</span><span>' +
            total +
            "건 — " +
            [...docsMap.keys()]
              .sort()
              .map(
                (id) =>
                  '<a href="#/' + id + '">' + escapeHtml(byId.get(id)?.meta.title || id) + "</a>",
              )
              .join(", ") +
            "</span></div>"
          );
        })
        .join("") +
      "</div>"
    : "";

  const cards = phases
    .map(
      (p) =>
        '<div class="card-group"><h3 class="card-group-title">' +
        escapeHtml(p.name) +
        '</h3><div class="cards">' +
        p.docs
          .map(
            (d) =>
              '<a class="card" href="#/' +
              d.id +
              '"><div class="card-head"><span class="card-title">' +
              escapeHtml(d.meta.title || d.id) +
              '</span><span class="pill s-' +
              (d.meta.status || "draft") +
              '">' +
              (STATUS_LABEL[d.meta.status] || d.meta.status || "초안") +
              '</span></div><p class="card-summary">' +
              escapeHtml(d.meta.summary || "") +
              "</p></a>",
          )
          .join("") +
        "</div></div>",
    )
    .join("");

  const count = (s) => docs.filter((d) => d.meta.status === s).length;
  const home =
    '<article class="doc doc-home" data-id="__home" data-title="홈"><div class="doc-inner"><div class="doc-body">' +
    '<div class="home-eyebrow">Project Documentation</div><h1>' +
    escapeHtml(config.project) +
    '</h1><p class="home-lead">구현 이전에 정립되어야 하는 정의를 모아둔 곳입니다. ' +
    "왼쪽에서 문서를 고르거나 아래 목록에서 시작하세요. " +
    (guideNav ? '처음이라면 <a href="#/__guide">가이드</a>부터 보세요.' : "") +
    "</p>" +
    '<div class="home-stats"><span><b>' +
    docs.length +
    "</b>문서</span><span><b>" +
    count("approved") +
    "</b>확정</span><span><b>" +
    count("review") +
    "</b>검토중</span><span><b>" +
    count("draft") +
    "</b>초안</span></div>" +
    stage1Panel +
    stage3Panel +
    blockerPanel +
    scopePanel +
    todoPanel +
    cards +
    "</div></div></article>";

  /* --- 추적성 매트릭스 --- */
  const traceRows = [...trace.owners.entries()]
    .sort()
    .map(([id, info]) => {
      const refDocs = [...(trace.refs.get(id) || [])].sort();
      return (
        "<tr><td><span class=\"chip\">" +
        id +
        '</span></td><td>' +
        escapeHtml(info.label || "") +
        '</td><td><a href="#/' +
        info.doc +
        '">' +
        escapeHtml(byId.get(info.doc)?.meta.title || info.doc) +
        "</a></td><td>" +
        (refDocs.length
          ? refDocs
              .map(
                (r) =>
                  '<a href="#/' + r + '">' + escapeHtml(byId.get(r)?.meta.title || r) + "</a>",
              )
              .join("<br>")
          : '<span class="muted">참조 없음</span>') +
        "</td></tr>"
      );
    })
    .join("");

  const traceArticle =
    '<article class="doc" data-id="__trace" data-title="추적성 매트릭스"><div class="doc-inner"><div class="doc-body">' +
    "<h1>추적성 매트릭스</h1>" +
    '<p class="home-lead">요구사항·리스크·결정 ID가 어디서 정의되고 어디서 참조되는지 자동 수집한 표입니다. ' +
    "참조가 없는 항목은 고아이거나, 아직 후속 문서에 반영되지 않은 것입니다.</p>" +
    '<div class="table-wrap"><table><thead><tr><th>ID</th><th>내용</th><th>정의</th><th>참조</th></tr></thead><tbody>' +
    (traceRows || '<tr><td colspan="4" class="muted">수집된 ID가 없습니다</td></tr>') +
    "</tbody></table></div></div></div></article>";

  return (
    "<!doctype html>\n" +
    '<html lang="ko"><head><meta charset="utf-8">' +
    '<meta name="viewport" content="width=device-width, initial-scale=1">' +
    "<title>" +
    escapeHtml(config.project) +
    " — Docs</title><style>" +
    CSS +
    "</style></head><body>" +
    '<button class="menu-btn" id="menuBtn" aria-label="문서 목록 열기">' + ICON.panel + "</button>" +
    '<nav class="sidebar" id="sidebar">' +
    '<div class="brand-row">' +
    '<a class="brand" href="#/__home"><span class="brand-mark"></span><span>' +
    escapeHtml(config.project) +
    "</span></a>" +
    '<button class="icon-btn" id="collapseBtn" title="사이드바 접기" aria-label="사이드바 접기">' +
    ICON.panel +
    "</button></div>" +
    '<div class="search-wrap"><div class="search-field">' +
    '<span class="search-icon">' + ICON.search + "</span>" +
    '<input id="search" type="search" placeholder="문서 검색" autocomplete="off" spellcheck="false">' +
    '<kbd class="search-kbd">/</kbd></div></div>' +
    '<div class="nav-tools">' +
    '<label class="nav-toggle"><input type="checkbox" id="inactiveMode">' +
    '<span>비활성 관리</span></label>' +
    '<span class="nav-count" id="inactiveCount"></span>' +
    "</div>" +
    '<div class="nav" id="nav">' +
    guideNav +
    navLink("__home", "홈", "home") +
    linksNav +
    navLink("__trace", "추적성 매트릭스", "utility") +
    discoveryNav +
    sidebar +
    designNav +
    implementationNav +
    "</div>" +
    '<button class="theme-btn" id="themeBtn">테마 전환</button></nav>' +
    '<div class="scrim" id="scrim"></div>' +
    '<main id="main">' +
    '<header class="topbar" id="topbar">' +
    '<button class="icon-btn topbar-reveal" id="revealBtn" title="사이드바 열기" aria-label="사이드바 열기">' +
    ICON.panel +
    "</button>" +
    '<span class="topbar-title" id="topbarTitle"></span>' +
    '<button class="icon-btn" id="widthBtn" title="본문 너비" aria-label="본문 너비 전환" aria-pressed="false">' +
    ICON.wide +
    "</button></header>" +
    '<article class="doc" data-id="__search" data-title="검색"><div class="doc-inner">' +
    '<div class="doc-body"><h1>검색</h1><div id="results"></div></div></div></article>' +
    guideArticle +
    home +
    linksArticle +
    mockupArticle +
    traceArticle +
    articles +
    "</main>" +
    (scripts
      ? '<div class="modal" id="exportModal" hidden>' +
        '<div class="modal-back" data-close-export></div>' +
        '<div class="modal-card" role="dialog" aria-modal="true" aria-labelledby="exportTitle">' +
        '<div class="modal-head">' +
        '<div><div class="modal-title" id="exportTitle">파일 스크립트 — 산출물 생성 대본</div>' +
        '<div class="modal-sub" id="exportSub"></div></div>' +
        '<button class="icon-btn" type="button" data-close-export aria-label="닫기">\u2715</button>' +
        "</div>" +
        '<div class="modal-bar">' +
        '<label class="modal-label" for="exportFormat">형식</label>' +
        '<select class="modal-select" id="exportFormat">' +
        SCRIPT_FORMATS.filter((f) => scripts[f.id])
          .map((f) => '<option value="' + f.id + '">' + f.label + "</option>")
          .join("") +
        "</select>" +
        '<span class="modal-install" id="exportInstall"></span>' +
        '<button class="modal-copy" type="button" id="exportCopy">대본 복사</button>' +
        "</div>" +
        '<div class="modal-body"><pre class="modal-code" id="exportCode"></pre></div>' +
        '<div class="modal-foot">복사해서 AI 에게 그대로 붙여 넣으면 됩니다. ' +
        '대본은 원본 <span class="mono" id="exportFile"></span> 을 가리킬 뿐 내용을 품지 않으므로, ' +
        "문서를 고친 뒤 같은 대본을 다시 써도 최신 내용으로 만들어집니다." +
        "</div></div></div>" +
        '<script id="exportScripts" type="application/json">' +
        JSON.stringify({
          scripts: scripts,
          formats: SCRIPT_FORMATS,
          shapes: Object.fromEntries(docs.map((d) => [d.id, docShape(d.id)])),
        })
          .replace(/</g, "\\u003c") +
        "<\/script>"
      : "") +
    '<script id="searchIndex" type="application/json">' +
    JSON.stringify(searchIndex).replace(/</g, "\\u003c") +
    "<\/script>" +
    "<script>" +
    JS +
    "<\/script></body></html>"
  );
}

/* ================================================================== *
 * 스타일 / 클라이언트 스크립트
 * ================================================================== */

const CSS = `
*,*::before,*::after{box-sizing:border-box}
:root{
  --bg:#fff; --bg-side:#f7f7f5; --bg-code:#f1f1ef; --bg-hl:#fdf3d9;
  --tx:#37352f; --tx-dim:rgba(55,53,47,.65); --tx-faint:rgba(55,53,47,.45);
  --line:rgba(55,53,47,.09); --line-strong:rgba(55,53,47,.16);
  --hover:rgba(55,53,47,.055); --active:rgba(55,53,47,.085);
  --accent:#2383e2; --red:#eb5757; --yellow:#d9a300; --orange:#d9730d; --green:#0f7b6c; --stage1:#6941c6; --stage3:#0f7b6c;
  --s-draft:#9b9a97; --s-review:#d9730d; --s-approved:#0f7b6c;
  --alert-bg:#fdf2f0; --alert-line:#f0c8c0; --alert-tx:#b02f1c;
  --side-w:264px; --content:768px; --content-wide:1180px;
  --ease:cubic-bezier(.32,.72,0,1);
}
[data-theme=dark]{
  --bg:#191919; --bg-side:#202020; --bg-code:#2b2b2b; --bg-hl:#4a3b1a;
  --tx:rgba(255,255,255,.85); --tx-dim:rgba(255,255,255,.55); --tx-faint:rgba(255,255,255,.38);
  --line:rgba(255,255,255,.09); --line-strong:rgba(255,255,255,.16);
  --hover:rgba(255,255,255,.055); --active:rgba(255,255,255,.09);
  --accent:#529cca; --stage1:#9e77ed; --stage3:#4dab9a;
  --s-draft:#979a9b; --s-review:#d9730d; --s-approved:#4dab9a;
  --alert-bg:#2d1f1c; --alert-line:#5c332a; --alert-tx:#ff9b8a;
}

/* ── 파일 스크립트 버튼 · 모달 ─────────────────────────────── */
.doc-export{margin-left:auto; font:inherit; font-size:12px; font-weight:500;
  color:var(--tx-dim); background:transparent; border:1px solid var(--line-strong);
  border-radius:6px; padding:3px 10px; cursor:pointer; white-space:nowrap;
  transition:background .12s, color .12s, border-color .12s}
.doc-export:hover{background:var(--hover); color:var(--tx); border-color:var(--tx-faint)}
.modal[hidden]{display:none}
.modal{position:fixed; inset:0; z-index:90; display:flex; align-items:center;
  justify-content:center; padding:24px}
.modal-back{position:absolute; inset:0; background:rgba(15,15,15,.45);
  backdrop-filter:blur(2px); animation:mfade .16s var(--ease)}
.modal-card{position:relative; display:flex; flex-direction:column;
  width:min(880px,100%); max-height:min(86vh,760px); background:var(--bg);
  border:1px solid var(--line-strong); border-radius:14px; overflow:hidden;
  box-shadow:0 24px 64px rgba(15,15,15,.22); animation:mrise .2s var(--ease)}
@keyframes mfade{from{opacity:0}}
@keyframes mrise{from{opacity:0; transform:translateY(10px) scale(.985)}}
.modal-head{display:flex; align-items:flex-start; gap:16px; padding:18px 20px 14px;
  border-bottom:1px solid var(--line)}
.modal-title{font-size:16px; font-weight:600; letter-spacing:-.01em}
.modal-sub{font-size:12.5px; color:var(--tx-dim); margin-top:2px}
.modal-head .icon-btn{margin-left:auto; flex:none}
.modal-bar{display:flex; align-items:center; gap:10px; flex-wrap:wrap;
  padding:12px 20px; background:var(--bg-side); border-bottom:1px solid var(--line)}
.modal-label{font-size:12px; color:var(--tx-dim); font-weight:500}
.modal-select{font:inherit; font-size:13px; color:var(--tx); background:var(--bg);
  border:1px solid var(--line-strong); border-radius:7px; padding:5px 10px; cursor:pointer}
.modal-install{font-family:var(--mono,ui-monospace,SFMono-Regular,Menlo,monospace);
  font-size:11.5px; color:var(--tx-dim); background:var(--bg-code);
  border-radius:5px; padding:3px 8px}
.modal-copy{margin-left:auto; font:inherit; font-size:12.5px; font-weight:600;
  color:#fff; background:var(--accent); border:0; border-radius:7px;
  padding:6px 14px; cursor:pointer}
.modal-copy:hover{filter:brightness(1.06)}
.modal-body{overflow:auto; background:var(--bg-code)}
.modal-code{margin:0; padding:18px 20px; font-size:12px; line-height:1.65;
  white-space:pre; color:var(--tx);
  font-family:var(--mono,ui-monospace,SFMono-Regular,Menlo,monospace)}
.modal-foot{padding:11px 20px; font-size:12px; color:var(--tx-dim);
  border-top:1px solid var(--line)}
@media(max-width:700px){
  .modal{padding:10px}
  .modal-copy{margin-left:0}
  .modal-code{font-size:11px}
}

/* ── 비활성 메뉴 ─────────────────────────────────────────── */
.nav-tools{display:flex; align-items:center; gap:8px; padding:2px 14px 8px}
.nav-toggle{display:inline-flex; align-items:center; gap:6px; cursor:pointer;
  font-size:11.5px; color:var(--tx-faint); user-select:none}
.nav-toggle input{width:12px; height:12px; margin:0; cursor:pointer; accent-color:var(--accent)}
.nav-toggle:hover{color:var(--tx-dim)}
.nav-count{margin-left:auto; font-size:10.5px; color:var(--tx-faint); font-variant-numeric:tabular-nums}
/* 한 번도 쓰이지 않은 메뉴 — 노란 점이 아니라 검정 점으로 죽여 둔다 */
.nav-item.unused .nav-dot,
.nav-group.p-yellow .nav-item.unused .nav-dot,
.nav-group.p-red .nav-item.unused .nav-dot,
.nav-group.p-orange .nav-item.unused .nav-dot,
.nav-group.p-green .nav-item.unused .nav-dot,
.nav-group.p-gray .nav-item.unused .nav-dot{
  background:#000; box-shadow:0 0 0 1px var(--line-strong)}
[data-theme=dark] .nav-item.unused .nav-dot,
[data-theme=dark] .nav-group .nav-item.unused .nav-dot{
  background:#000; box-shadow:0 0 0 1px rgba(255,255,255,.22)}
.nav-item.unused .nav-label{color:var(--tx-faint)}
.nav-item.unused:hover .nav-label{color:var(--tx-dim)}
/* 관리 모드
 *
 * 체크박스를 절대 배치하면 상태 점과 겹친다(7~19 vs 18~23). 행은 이미
 * flex + gap 이므로 흐름 안에 두면 간격이 저절로 맞는다. */
.nav-check{display:none; flex:none; width:13px; height:13px; margin:0;
  cursor:pointer; accent-color:var(--accent)}
body.inactive-mode .nav-check{display:block}
/* 체크박스가 없는 행(홈·가이드·추적성)도 왼쪽을 맞춘다.
 * 8 + 13 + 8 = 29 — 체크박스가 차지하는 폭만큼 밀어 준다. */
body.inactive-mode .nav-item{padding-left:29px}
body.inactive-mode .nav-item.has-check{padding-left:8px}
body.inactive-mode .nav-item:hover{background:var(--hover)}
body.inactive-mode .nav-tools{background:var(--hover); border-radius:7px;
  margin:0 6px 8px; padding:7px 9px}
body.inactive-mode .nav-toggle{color:var(--tx)}
html{-webkit-text-size-adjust:100%}
body{
  margin:0; background:var(--bg); color:var(--tx);
  font-family:ui-sans-serif,-apple-system,BlinkMacSystemFont,"Segoe UI",
    "Pretendard Variable",Pretendard,"Apple SD Gothic Neo","Noto Sans KR",sans-serif;
  font-size:16px; line-height:1.6; word-break:keep-all; overflow-wrap:break-word;
  -webkit-font-smoothing:antialiased; -moz-osx-font-smoothing:grayscale;
  font-variant-numeric:tabular-nums;
}
a{color:inherit}
.muted{color:var(--tx-faint)}
:focus-visible{outline:2px solid var(--accent); outline-offset:2px; border-radius:3px}

.icon-btn{
  display:inline-flex; align-items:center; justify-content:center; flex:none;
  width:28px; height:28px; padding:0; border:none; border-radius:6px; cursor:pointer;
  background:transparent; color:var(--tx-faint); line-height:0;
  transition:background .12s, color .12s;
}
.icon-btn svg,.brand-mark,.search-icon svg{display:block}
.icon-btn:hover{background:var(--hover); color:var(--tx)}
.icon-btn[aria-pressed=true]{color:var(--accent)}

/* ── Sidebar ─────────────────────────────────────────── */
.sidebar{
  position:fixed; inset:0 auto 0 0; width:var(--side-w); background:var(--bg-side);
  border-right:1px solid var(--line); display:flex; flex-direction:column; z-index:20;
  transition:transform .28s var(--ease);
}
.brand-row{display:flex; align-items:center; gap:6px; padding:10px 10px 8px; flex:none}
.brand{
  display:flex; align-items:center; gap:8px; flex:1; min-width:0;
  font-weight:600; font-size:14px; line-height:1.2; text-decoration:none;
  letter-spacing:-.01em; padding-left:2px;
}
.brand>span:last-child{overflow:hidden; text-overflow:ellipsis; white-space:nowrap}
.brand-mark{width:17px; height:17px; border-radius:4px; flex:none;
  background:linear-gradient(135deg,#0a2240,#00a3e0)}
.search-wrap{padding:0 10px 8px; flex:none}
.search-field{position:relative; display:block}
.search-icon{position:absolute; left:9px; top:50%; transform:translateY(-50%);
  color:var(--tx-faint); pointer-events:none; display:flex; line-height:0}
.search-kbd{position:absolute; right:9px; top:50%; transform:translateY(-50%);
  display:flex; align-items:center; height:16px;
  font:inherit; font-size:11px; line-height:1; color:var(--tx-faint); background:var(--bg);
  border:1px solid var(--line-strong); border-radius:3px; padding:0 5px;
  pointer-events:none; transition:opacity .12s}
#search{
  display:block; height:30px;
  width:100%; padding:0 30px 0 28px; font:inherit; font-size:13.5px; color:var(--tx);
  background:var(--bg); border:1px solid var(--line-strong); border-radius:6px; outline:none;
  transition:border-color .12s, box-shadow .12s;
}
#search:focus{border-color:var(--accent); box-shadow:0 0 0 3px color-mix(in srgb, var(--accent) 18%, transparent)}
#search:focus + .search-kbd{opacity:0}
#search::-webkit-search-cancel-button{display:none}
.nav{flex:1; overflow-y:auto; overscroll-behavior:contain; padding:2px 8px 16px}
.nav-group{margin-top:16px}
.nav-group-title{display:flex;align-items:center;justify-content:space-between;gap:8px;padding:4px 8px;font-size:11px;font-weight:650;letter-spacing:.05em;color:var(--tx-faint);text-transform:uppercase}
.nav-progress{font-weight:700;letter-spacing:0}.nav-progress.p-gray{color:var(--s-draft)}.nav-progress.p-red{color:var(--red)}.nav-progress.p-yellow{color:var(--yellow)}.nav-progress.p-orange{color:var(--orange)}.nav-progress.p-green{color:var(--green)}
.nav-subgroup{margin-top:9px}.nav-subgroup-title{padding:3px 8px;font-size:10.5px;color:var(--tx-faint)}
.nav-empty{padding:4px 8px;font-size:12px;color:var(--tx-faint)}
.nav-item{
  display:flex; align-items:center; gap:8px; padding:5px 8px; border-radius:6px;
  font-size:13.5px; color:var(--tx-dim); text-decoration:none; line-height:1.4;
  transition:background .1s, color .1s;
}
.nav-item:hover{background:var(--hover); color:var(--tx)}
.nav-item.active{background:var(--active); color:var(--tx); font-weight:500}
.nav-dot{width:5px; height:5px; border-radius:50%; flex:none; background:var(--s-draft)}
.nav-dot.s-review{background:var(--orange)}
.nav-dot.s-approved{background:var(--s-approved)}
.nav-dot.s-utility{background:var(--s-draft)}
.nav-dot.s-home{background:var(--accent)}
.nav-group.p-gray .nav-dot{background:var(--s-draft)}.nav-group.p-red .nav-dot{background:var(--red)}.nav-group.p-yellow .nav-dot{background:var(--yellow)}.nav-group.p-orange .nav-dot{background:var(--orange)}.nav-group.p-green .nav-dot{background:var(--green)}
.pill.s-stage3{background:var(--stage3)}
.chip-stage3{background:var(--stage3); color:#fff}
.nav-group.nav-stage3{padding-bottom:12px; border-bottom:1px solid var(--line)}
.panel-stage3{border-color:var(--stage3)}
.panel-stage3 .panel-title{color:var(--stage3)}
.logo{position:relative; width:18px; height:18px; flex:none; border-radius:4px; background:#fff;
  border:1px solid var(--line-strong); overflow:hidden}
.logo i{position:absolute; inset:0; display:grid; place-items:center; font-style:normal;
  font-size:10px; font-weight:700; color:var(--brand,#555)}
.logo img{position:relative; display:block; width:100%; height:100%; padding:3px; object-fit:contain}
.logo-add i{color:var(--tx-faint); font-size:13px}
.links-grid{display:grid; grid-template-columns:repeat(auto-fill,minmax(250px,1fr)); gap:10px; margin-top:22px}
.link-card{display:flex; flex-direction:column; gap:6px; padding:14px 16px;
  border:1px solid var(--line-strong); border-radius:8px; background:var(--bg)}
.link-card.on{border-color:var(--green)}
.link-card.link-add{border-style:dashed}
.link-head{display:flex; align-items:center; gap:8px}
.link-head .logo{width:22px; height:22px}
.link-name{font-weight:600; font-size:14px}
.link-head .pill{margin-left:auto}
.link-head .pill ~ .pill{margin-left:0}
.link-url{font-size:11.5px; color:var(--tx-faint); word-break:break-all}
.link-actions{display:flex; gap:6px; margin-top:auto; padding-top:6px}
.link-btn{display:inline-flex; align-items:center; justify-content:center; padding:5px 10px;
  border:1px solid var(--line-strong); border-radius:6px; background:transparent; cursor:pointer;
  font:inherit; font-size:12px; color:var(--tx-dim); text-decoration:none; white-space:nowrap}
.link-btn:hover{background:var(--hover); color:var(--tx)}
.link-btn.primary{border-color:var(--accent); color:var(--accent)}
.mockups{display:grid; grid-template-columns:repeat(auto-fill,minmax(230px,1fr)); gap:10px; margin-top:20px}
.mockup{display:flex; align-items:center; justify-content:space-between; gap:10px;
  padding:14px 16px; border:1px solid var(--line-strong); border-radius:8px;
  text-decoration:none; background:var(--bg); transition:background .12s, border-color .12s}
.mockup:hover{background:var(--hover); border-color:var(--stage3)}
.mockup-name{font-weight:600; font-size:14px}
.mockup-go{font-size:12px; color:var(--tx-faint); white-space:nowrap}
.nav-item[data-id="__guide"]{font-weight:500; color:var(--tx)}
.nav-item.nav-ext{text-decoration:none}
.nav-group.nav-stage1{padding-bottom:12px; border-bottom:1px solid var(--line)}
.theme-btn{flex:none; padding:9px 14px; font:inherit; font-size:12.5px; text-align:left;
  color:var(--tx-faint); background:none; border:none; border-top:1px solid var(--line); cursor:pointer}
.theme-btn:hover{color:var(--tx)}

/* ── Collapse ────────────────────────────────────────── */
body.sb-collapsed .sidebar{transform:translateX(-100%)}
body.sb-collapsed main{margin-left:0}
.topbar-reveal{display:none}
body.sb-collapsed .topbar-reveal{display:inline-flex}

/* ── Main ────────────────────────────────────────────── */
main{margin-left:var(--side-w); min-height:100vh; transition:margin-left .28s var(--ease)}
.topbar{
  position:sticky; top:0; z-index:10; display:flex; align-items:center; gap:8px;
  height:44px; padding:0 16px; background:color-mix(in srgb, var(--bg) 82%, transparent);
  backdrop-filter:saturate(180%) blur(12px); border-bottom:1px solid transparent;
  transition:border-color .15s;
}
body.scrolled .topbar{border-bottom-color:var(--line)}
.topbar-title{flex:1; min-width:0; font-size:13.5px; font-weight:500; color:var(--tx-dim);
  overflow:hidden; text-overflow:ellipsis; white-space:nowrap}

.doc{display:none}
.doc.active{display:block}
.doc-inner{display:flex; gap:44px; align-items:flex-start; padding:40px 60px 160px; justify-content:center}
.doc-body{width:100%; max-width:var(--content); min-width:0; transition:max-width .32s var(--ease)}
body.wide .doc-body{max-width:var(--content-wide)}
body.wide .toc{opacity:.55}
.doc-meta{display:flex; align-items:center; gap:9px; flex-wrap:wrap;
  font-size:12.5px; color:var(--tx-faint); margin-bottom:28px}
.meta-sep{width:3px; height:3px; border-radius:50%; background:var(--tx-faint)}
.mono{font-family:ui-monospace,SFMono-Regular,Menlo,monospace}

.toc{position:sticky; top:64px; width:186px; flex:none; font-size:12.5px; padding-top:2px;
  transition:opacity .3s}
.toc-title{color:var(--tx-faint); font-size:11px; font-weight:600; letter-spacing:.05em;
  text-transform:uppercase; margin-bottom:8px}
.toc a{display:block; padding:4px 0 4px 11px; color:var(--tx-dim); text-decoration:none;
  border-left:2px solid var(--line); line-height:1.45; transition:color .12s, border-color .12s}
.toc a:hover{color:var(--tx)}
.toc a.active{color:var(--tx); border-left-color:var(--tx); font-weight:500}

/* ── Typography ──────────────────────────────────────── */
.doc-body h1{font-size:40px; line-height:1.15; letter-spacing:-.022em; font-weight:700; margin:0 0 4px}
.doc-body h2{font-size:25px; line-height:1.3; letter-spacing:-.012em; font-weight:600;
  margin:1.9em 0 .35em; padding-top:.15em}
.doc-body h3{font-size:19px; line-height:1.35; letter-spacing:-.008em; font-weight:600; margin:1.5em 0 .25em}
.doc-body h4{font-size:16px; font-weight:600; margin:1.3em 0 .15em}
.doc-body p{margin:.5em 0; line-height:1.75}
.doc-body ul,.doc-body ol{margin:.45em 0; padding-left:1.5em}
.doc-body li{margin:.2em 0; line-height:1.7}
.doc-body li::marker{color:var(--tx-faint)}
.doc-body ul.task-list{list-style:none; padding-left:.15em}
.doc-body ul.task-list li{display:flex; align-items:flex-start; gap:8px}
.doc-body ul.task-list input{margin-top:.45em; flex:none; accent-color:var(--accent)}
.doc-body a{color:var(--tx); text-decoration:underline;
  text-decoration-color:var(--line-strong); text-underline-offset:3px; text-decoration-thickness:1px}
.doc-body a:hover{text-decoration-color:var(--tx)}
.doc-body strong{font-weight:600}
.doc-body code{font-family:ui-monospace,SFMono-Regular,Menlo,monospace; font-size:.85em;
  background:var(--bg-code); color:var(--red); padding:.15em .4em; border-radius:4px}
.swatch{display:inline-block; width:.85em; height:.85em; border-radius:3px;
  border:1px solid var(--line-strong); margin-right:.35em; vertical-align:-.08em;
  box-shadow:inset 0 0 0 1px rgba(255,255,255,.35)}
.doc-body pre{background:var(--bg-side); border:1px solid var(--line); border-radius:6px;
  padding:16px 18px; overflow-x:auto; margin:.9em 0; line-height:1.55}
.doc-body pre code{background:none; color:var(--tx); padding:0; font-size:12.5px}
.doc-body blockquote{margin:1em 0; padding:12px 16px; background:var(--bg-side);
  border-left:3px solid var(--tx-faint); border-radius:0 4px 4px 0}
.doc-body blockquote p{margin:.2em 0}
.doc-body hr{border:none; border-top:1px solid var(--line); margin:2.4em 0}
.table-wrap{overflow-x:auto; margin:1em 0; border-radius:6px}
.doc-body table{border-collapse:collapse; font-size:13.5px; min-width:100%}
.doc-body th,.doc-body td{border:1px solid var(--line-strong); padding:8px 12px;
  text-align:left; vertical-align:top; line-height:1.6}
.doc-body th{background:var(--bg-side); font-weight:600; white-space:nowrap; font-size:13px}
.doc-body tbody tr:hover{background:var(--hover)}
.log-date{margin:1.1em 0;border:1px solid var(--line);border-radius:8px;background:var(--bg)}
.log-date>summary{cursor:pointer;padding:12px 14px;font-weight:650;list-style-position:inside}
.log-date-body{padding:0 14px 14px}.log-date-body>h3:first-child{margin-top:.5em}
.doc-body h2[id]:target,.flash{animation:flash 1.6s var(--ease)}
@keyframes flash{0%,35%{background:var(--bg-hl)}100%{background:transparent}}

a.wikilink{text-decoration-color:var(--accent)}
a.wikilink::before{content:"→ "; color:var(--accent); text-decoration:none}
a.wikilink.broken{color:var(--red); text-decoration-style:wavy}

.pill{display:inline-block; padding:1.5px 8px; border-radius:4px; font-size:11.5px;
  font-weight:500; white-space:nowrap; color:#fff; background:var(--s-draft)}
.pill.s-review{background:var(--s-review)}
.pill.s-approved{background:var(--s-approved)}
.pill.s-stage1{background:var(--stage1)}
.chip{display:inline-block; padding:1.5px 7px; border-radius:4px; font-size:12px; font-weight:600;
  font-family:ui-monospace,SFMono-Regular,Menlo,monospace; background:var(--bg-code); color:var(--tx-dim)}
.chip-alert{background:var(--alert-line); color:var(--alert-tx)}
.chip-stage1{background:var(--stage1); color:#fff}

.idchips{margin-top:3em; padding-top:14px; border-top:1px solid var(--line); font-size:13px}
.idchips-title{color:var(--tx-faint); margin-right:8px}
.idchips .chip{margin:0 4px 4px 0}
.backlinks{margin-top:1.6em; padding:14px 16px; background:var(--bg-side); border-radius:6px; font-size:13.5px}
.backlinks-title{color:var(--tx-faint); font-size:11px; font-weight:600; letter-spacing:.05em;
  text-transform:uppercase; margin-bottom:7px}
.backlinks a{display:block; padding:2px 0; color:var(--tx-dim); text-decoration:none}
.backlinks a:hover{color:var(--tx)}

.panel{margin:24px 0; border:1px solid var(--line-strong); border-radius:8px; padding:14px 16px; font-size:13.5px}
.panel-alert{background:var(--alert-bg); border-color:var(--alert-line)}
.panel-stage1{border-color:var(--stage1)}
.panel-title{font-size:11px; font-weight:600; letter-spacing:.05em; text-transform:uppercase;
  color:var(--tx-faint); margin-bottom:9px}
.panel-alert .panel-title{color:var(--alert-tx)}
.panel-stage1 .panel-title{color:var(--stage1)}
.panel-row{display:flex; align-items:baseline; gap:9px; padding:3px 0; text-decoration:none; color:var(--tx-dim)}
a.panel-row:hover{color:var(--tx)}
.panel-row .chip{flex:none}
.scope{display:flex; flex-wrap:wrap; gap:6px}
.scope-item{padding:2px 9px; border-radius:4px; font-size:12px;
  font-family:ui-monospace,SFMono-Regular,Menlo,monospace}
.scope-item.on{background:var(--s-approved); color:#fff}
.scope-item.off{background:var(--bg-code); color:var(--tx-faint); text-decoration:line-through}

.home-eyebrow{font-size:11.5px; font-weight:600; letter-spacing:.09em; text-transform:uppercase;
  color:var(--tx-faint); margin-bottom:10px}
.home-lead{font-size:16px; color:var(--tx-dim); max-width:62ch; margin:.6em 0 0; line-height:1.7}
.home-stats{display:flex; gap:24px; margin:26px 0 8px; font-size:13px; color:var(--tx-dim)}
.home-stats b{color:var(--tx); font-size:18px; font-weight:600; margin-right:5px}
.card-group{margin-top:36px}
.card-group-title{font-size:11.5px; font-weight:600; letter-spacing:.06em; text-transform:uppercase;
  color:var(--tx-faint); margin:0 0 12px}
.cards{display:grid; grid-template-columns:repeat(auto-fill,minmax(250px,1fr)); gap:10px}
.card{display:block; padding:14px 16px; border:1px solid var(--line-strong); border-radius:8px;
  text-decoration:none; background:var(--bg); transition:background .12s, border-color .12s, transform .12s}
.card:hover{background:var(--hover); border-color:var(--tx-faint)}
.card-head{display:flex; align-items:center; justify-content:space-between; gap:10px; margin-bottom:5px}
.card-title{font-weight:600; font-size:14px}
.card-summary{margin:0; font-size:12.5px; color:var(--tx-dim); line-height:1.55}

/* ── Search results ──────────────────────────────────── */
.res-meta{font-size:13px; color:var(--tx-faint); margin:-4px 0 18px}
.res{display:block; padding:12px 14px; margin-bottom:8px; border:1px solid var(--line);
  border-radius:8px; text-decoration:none; transition:background .12s, border-color .12s}
.res:hover{background:var(--hover); border-color:var(--line-strong)}
.res-head{display:flex; align-items:baseline; gap:8px; margin-bottom:4px; flex-wrap:wrap}
.res-doc{font-size:13.5px; font-weight:600; color:var(--tx)}
.res-sec{font-size:12.5px; color:var(--tx-faint)}
.res-snip{font-size:13px; color:var(--tx-dim); line-height:1.6; margin:0}
.res mark{background:var(--bg-hl); color:inherit; border-radius:2px; padding:0 1px}
.res-empty{display:flex; flex-direction:column; align-items:center; justify-content:center;
  text-align:center; padding:72px 24px; color:var(--tx-faint); gap:2px}
.res-empty svg{color:var(--line-strong); margin-bottom:12px}
.res-empty-title{margin:0; font-size:15px; font-weight:500; color:var(--tx-dim)}
.res-empty-hint{margin:0; font-size:13px; line-height:1.6; max-width:38ch}

.menu-btn,.scrim{display:none}

@media (max-width:1240px){ .toc{display:none} .doc-inner{padding:36px 44px 120px} }
@media (max-width:860px){
  .menu-btn{display:inline-flex; position:fixed; top:8px; left:10px; z-index:40;
    width:30px; height:30px; padding:0; cursor:pointer; background:var(--bg); color:var(--tx);
    border:1px solid var(--line-strong); border-radius:6px;
    align-items:center; justify-content:center; line-height:0}
  .menu-btn svg{display:block}
  .sidebar{transform:translateX(-100%)}
  body.nav-open .sidebar{transform:none}
  body.nav-open .scrim{display:block; position:fixed; inset:0; background:rgba(0,0,0,.35); z-index:15}
  main{margin-left:0}
  .topbar{padding-left:50px}
  .topbar-reveal{display:none !important}
  .doc-inner{padding:28px 20px 100px}
  .doc-body h1{font-size:30px}
  .doc-body h2{font-size:21px}
  .cards{grid-template-columns:1fr}
  .links-grid{grid-template-columns:1fr}
}
@media (prefers-reduced-motion:reduce){ *{transition-duration:.01ms !important; animation-duration:.01ms !important} }
`;

const JS = `
(function(){
  var docs  = [].slice.call(document.querySelectorAll('.doc'));
  var items = [].slice.call(document.querySelectorAll('.nav-item'));
  var main  = document.getElementById('main');
  var title = document.getElementById('topbarTitle');
  var body  = document.body;
  var INDEX = JSON.parse(document.getElementById('searchIndex').textContent || '[]');
  var ICON_EMPTY =
    '<svg viewBox="0 0 48 48" width="38" height="38" aria-hidden="true" fill="none" ' +
    'stroke="currentColor" stroke-width="2.4" stroke-linecap="round">' +
    '<circle cx="21" cy="21" r="13"/><line x1="30.5" y1="30.5" x2="41" y2="41"/>' +
    '<line x1="16.5" y1="21" x2="25.5" y2="21"/></svg>';

  function byId(id){ return docs.filter(function(d){ return d.dataset.id === id; })[0]; }

  function show(id){
    var found = false;
    docs.forEach(function(d){
      var on = d.dataset.id === id;
      d.classList.toggle('active', on);
      if(on) found = true;
    });
    if(!found && docs.length){ docs[0].classList.add('active'); id = docs[0].dataset.id; }
    items.forEach(function(a){ a.classList.toggle('active', a.dataset.id === id); });
    var cur = byId(id);
    title.textContent = cur ? (cur.dataset.title || '') : '';
    body.classList.remove('nav-open');
    spy();
  }

  function fromHash(){
    var raw = location.hash.replace(/^#[/]/, '');
    if(!raw || raw.charAt(0) === '#'){ show('__home'); return; }
    var parts = decodeURIComponent(raw).split('@');
    show(parts[0]);
    window.scrollTo(0,0);
    if(parts[1]) jump(parts[1]);
  }
  window.addEventListener('hashchange', fromHash);

  function jump(anchor){
    setTimeout(function(){
      var el = document.getElementById(anchor);
      if(!el) return;
      el.scrollIntoView({behavior:'smooth', block:'start'});
      el.classList.remove('flash');
      void el.offsetWidth;
      el.classList.add('flash');
    }, 40);
  }

  // 문서 내 앵커는 페이지 전환이 아니라 스크롤
  document.addEventListener('click', function(e){
    var a = e.target.closest && e.target.closest('a[href^="#"]');
    if(!a) return;
    var href = a.getAttribute('href');
    if(href.indexOf('#/') === 0) return;
    var el = document.getElementById(href.slice(1));
    if(el){ e.preventDefault(); el.scrollIntoView({behavior:'smooth', block:'start'}); }
  });



  /* ── 비활성 메뉴 관리 ────────────────────────────
   * 자동 판정(data-used=0)이 기본이고, 사용자가 체크로 덮어쓴다.
   * index.html 은 빌드마다 새로 만들어지므로 덮어쓴 값은 문서 id 로
   * localStorage 에 둔다 — 다시 빌드해도 유지된다. */
  (function(){
    var box = document.getElementById('inactiveMode');
    var nav = document.getElementById('nav');
    var count = document.getElementById('inactiveCount');
    if(!box || !nav) return;
    var KEY = 'inactiveDocs';

    function load(){
      try { return JSON.parse(localStorage.getItem(KEY)) || {}; }
      catch(e){ return {}; }
    }
    function save(map){
      try { localStorage.setItem(KEY, JSON.stringify(map)); } catch(e){}
    }

    var overrides = load();
    var items = [].slice.call(nav.querySelectorAll('.nav-item[data-used]'));

    function isInactive(item){
      var id = item.getAttribute('data-id');
      if(Object.prototype.hasOwnProperty.call(overrides, id)) return !!overrides[id];
      return item.getAttribute('data-used') === '0';
    }

    function paint(){
      var n = 0;
      items.forEach(function(item){
        var off = isInactive(item);
        item.classList.toggle('unused', off);
        var cb = item.querySelector('.nav-check');
        if(cb) cb.checked = off;
        if(off) n++;
      });
      count.textContent = n ? ('비활성 ' + n + ' / ' + items.length) : '';
    }

    // 관리 모드에서 쓸 체크박스를 미리 넣어 둔다 (CSS 로 보였다 숨긴다)
    items.forEach(function(item){
      var cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.className = 'nav-check';
      cb.title = '비활성으로 표시';
      item.insertBefore(cb, item.firstChild);
      item.classList.add('has-check');
    });

    /* 체크박스가 <a> 안에 있어 클릭이 그대로 두면 문서 이동까지 간다.
     * 문서 캡처 단계에서 먼저 가로채 라우터보다 앞서 끊는다. */
    document.addEventListener('click', function(e){
      var cb = e.target;
      if(!cb.classList || !cb.classList.contains('nav-check')) return;
      e.preventDefault();
      e.stopPropagation();
      if(e.stopImmediatePropagation) e.stopImmediatePropagation();
      var item = cb.closest('.nav-item');
      if(!item) return;
      var id = item.getAttribute('data-id');
      var next = !isInactive(item);
      var auto = item.getAttribute('data-used') === '0';
      // 자동 판정과 같아지면 덮어쓰기를 지운다 — 쓸데없는 저장을 남기지 않는다
      if(next === auto) delete overrides[id];
      else overrides[id] = next;
      save(overrides);
      paint();
    }, true);

    box.addEventListener('change', function(){
      document.body.classList.toggle('inactive-mode', box.checked);
      try { localStorage.setItem('inactiveMode', box.checked ? '1' : ''); } catch(e){}
    });
    try {
      if(localStorage.getItem('inactiveMode')){
        box.checked = true;
        document.body.classList.add('inactive-mode');
      }
    } catch(e){}

    paint();
  })();

  /* ── 파일 스크립트 모달 ──────────────────────────── */
  (function(){
    var node = document.getElementById('exportScripts');
    var modal = document.getElementById('exportModal');
    if(!node || !modal) return;
    var data = JSON.parse(node.textContent);
    var sel = document.getElementById('exportFormat');
    var code = document.getElementById('exportCode');
    var install = document.getElementById('exportInstall');
    var sub = document.getElementById('exportSub');
    var fileEl = document.getElementById('exportFile');
    var copyBtn = document.getElementById('exportCopy');
    var cur = { file: '', title: '' };
    var lastFocus = null;

    function fmt(id){
      for(var i=0;i<data.formats.length;i++){ if(data.formats[i].id===id) return data.formats[i]; }
      return data.formats[0];
    }
    function stem(file){ return file.replace(/\.[^.]+$/, ''); }

    function render(){
      var f = fmt(sel.value);
      var src = data.scripts[f.id] || '';
      code.textContent = src
        .split('__SHAPE__').join((data.shapes && data.shapes[cur.id]) || '')
        .split('__DOC_FILE__').join(cur.file)
        .split('__DOC_TITLE__').join(cur.title)
        .split('__DOC_STEM__').join(stem(cur.file));
      install.textContent = stem(cur.file) + '.' + f.ext;
      try { localStorage.setItem('exportFormat', f.id); } catch(e){}
    }

    function open(btn){
      cur.file = btn.getAttribute('data-export-file') || '';
      cur.title = btn.getAttribute('data-export-title') || '';
      cur.id = btn.getAttribute('data-export-id') || '';
      sub.textContent = cur.title;
      fileEl.textContent = cur.file;
      try {
        var saved = localStorage.getItem('exportFormat');
        if(saved && data.scripts[saved]) sel.value = saved;
      } catch(e){}
      render();
      lastFocus = btn;
      modal.hidden = false;
      document.body.style.overflow = 'hidden';
      sel.focus();
    }
    function close(){
      modal.hidden = true;
      document.body.style.overflow = '';
      if(lastFocus) lastFocus.focus();
    }

    document.addEventListener('click', function(e){
      var btn = e.target.closest && e.target.closest('[data-export-file]');
      if(btn){ e.preventDefault(); open(btn); return; }
      if(e.target.closest && e.target.closest('[data-close-export]')) close();
    });
    document.addEventListener('keydown', function(e){
      if(e.key === 'Escape' && !modal.hidden) close();
    });
    sel.addEventListener('change', render);

    copyBtn.addEventListener('click', function(){
      var text = code.textContent;
      var label = copyBtn.textContent;
      function done(){
        copyBtn.textContent = '복사됨 ✓';
        setTimeout(function(){ copyBtn.textContent = label; }, 1600);
      }
      function fallback(){
        var ta = document.createElement('textarea');
        ta.value = text; ta.setAttribute('readonly','');
        ta.style.position='fixed'; ta.style.opacity='0';
        document.body.appendChild(ta); ta.select();
        try { document.execCommand('copy'); done(); }
        catch(err){ copyBtn.textContent = '복사 실패'; }
        ta.remove();
      }
      if(navigator.clipboard && navigator.clipboard.writeText){
        navigator.clipboard.writeText(text).then(done, fallback);
      } else { fallback(); }
    });
  })();

  /* ── 연동 카드: 문구 복사 ──────────────────────── */
  document.addEventListener('click', function(e){
    var b = e.target.closest && e.target.closest('[data-copy]');
    if(!b) return;
    var text = b.getAttribute('data-copy');
    var label = b.textContent;
    function done(){
      b.textContent = '복사됨 ✓';
      setTimeout(function(){ b.textContent = label; }, 1600);
    }
    function fallback(){
      var ta = document.createElement('textarea');
      ta.value = text; ta.setAttribute('readonly','');
      ta.style.position = 'fixed'; ta.style.opacity = '0';
      document.body.appendChild(ta); ta.select();
      try { document.execCommand('copy'); done(); } catch(err) { b.textContent = '복사 실패'; }
      ta.remove();
    }
    if(navigator.clipboard && navigator.clipboard.writeText){
      navigator.clipboard.writeText(text).then(done, fallback);
    } else { fallback(); }
  });

  /* ── 전문 검색 ───────────────────────────────────── */
  var search  = document.getElementById('search');
  var results = document.getElementById('results');
  var lastView = '__home';

  function esc(t){
    return t.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
            .replace(/"/g,'&quot;');
  }

  // 공백으로 끊어 키워드 단위로 본다. 순서·연속 여부와 무관하게 모두 포함돼야 일치.
  function tokenize(q){
    return q.toLowerCase().split(/\s+/).filter(function(t){ return t.length > 0; });
  }

  // 여러 키워드의 일치 구간을 모아 겹치는 것끼리 합친다
  function spansOf(lower, tokens){
    var spans = [];
    tokens.forEach(function(tk){
      var from = 0, i;
      while((i = lower.indexOf(tk, from)) > -1){
        spans.push([i, i + tk.length]);
        from = i + tk.length;
      }
    });
    if(!spans.length) return spans;
    spans.sort(function(a,b){ return a[0] - b[0]; });
    var merged = [], cur = spans[0].slice();
    for(var k = 1; k < spans.length; k++){
      if(spans[k][0] <= cur[1]) cur[1] = Math.max(cur[1], spans[k][1]);
      else { merged.push(cur); cur = spans[k].slice(); }
    }
    merged.push(cur);
    return merged;
  }

  function markAll(text, tokens){
    var merged = spansOf(text.toLowerCase(), tokens);
    if(!merged.length) return esc(text);
    var out = '', pos = 0;
    merged.forEach(function(m){
      out += esc(text.slice(pos, m[0])) + '<mark>' + esc(text.slice(m[0], m[1])) + '</mark>';
      pos = m[1];
    });
    return out + esc(text.slice(pos));
  }

  function snippet(text, tokens){
    var merged = spansOf(text.toLowerCase(), tokens);
    if(!merged.length) return esc(text.slice(0, 150)) + (text.length > 150 ? '…' : '');
    var start = Math.max(0, merged[0][0] - 55);
    var end = Math.min(text.length, Math.max(merged[0][1] + 110, start + 165));
    return (start > 0 ? '…' : '') + markAll(text.slice(start, end), tokens) +
           (end < text.length ? '…' : '');
  }

  // 제목 > 섹션명 > 본문 순으로 가중치를 준다
  function score(entry, tokens){
    var name = (entry.n || '').toLowerCase();
    var head = (entry.h || '').toLowerCase();
    var text = entry.t.toLowerCase();
    var total = 0;
    for(var i = 0; i < tokens.length; i++){
      var tk = tokens[i], got = 0;
      if(name.indexOf(tk) > -1){ total += 6; got = 1; }
      if(head.indexOf(tk) > -1){ total += 4; got = 1; }
      var at = text.indexOf(tk);
      if(at > -1){
        got = 1;
        total += 2;
        total += Math.min(text.split(tk).length - 1, 4) * 0.5;  // 반복 등장 가산
        total += at < 60 ? 1 : 0;                                // 앞쪽 등장 가산
      }
      if(!got) return -1;   // 키워드 하나라도 없으면 탈락 (AND)
    }
    return total;
  }

  function runSearch(q){
    var tokens = tokenize(q);
    if(!tokens.length){ results.innerHTML = ''; return; }

    var hits = [];
    for(var i = 0; i < INDEX.length; i++){
      var sc = score(INDEX[i], tokens);
      if(sc >= 0) hits.push({ e: INDEX[i], s: sc });
    }
    hits.sort(function(a,b){ return b.s - a.s; });
    hits = hits.slice(0, 60);

    if(!hits.length){
      results.innerHTML =
        '<div class="res-empty">' + ICON_EMPTY +
        '<p class="res-empty-title">일치하는 내용이 없습니다</p>' +
        '<p class="res-empty-hint">키워드를 줄이거나 다른 낱말로 찾아보세요. ' +
        '여러 낱말을 넣으면 모두 포함된 곳만 찾습니다.</p></div>';
      return;
    }

    results.innerHTML =
      '<p class="res-meta">' + hits.length + '개 결과' +
      (tokens.length > 1 ? ' · 키워드 ' + tokens.length + '개 모두 포함' : '') + '</p>' +
      hits.map(function(x){
        var e = x.e;
        var href = '#/' + e.d + (e.a ? '@' + e.a : '');
        return '<a class="res" href="' + href + '">' +
          '<div class="res-head"><span class="res-doc">' + markAll(e.n, tokens) + '</span>' +
          (e.h ? '<span class="res-sec">› ' + markAll(e.h, tokens) + '</span>' : '') + '</div>' +
          '<p class="res-snip">' + snippet(e.t, tokens) + '</p></a>';
      }).join('');
  }

  search.addEventListener('input', function(){
    var q = search.value.trim().toLowerCase();
    if(!q){
      if(document.querySelector('.doc.active') === byId('__search')) show(lastView);
      return;
    }
    var active = document.querySelector('.doc.active');
    if(active && active.dataset.id !== '__search') lastView = active.dataset.id;
    runSearch(q);
    show('__search');
  });
  search.addEventListener('keydown', function(e){
    if(e.key === 'Escape'){ search.value=''; search.blur(); show(lastView); }
  });
  document.addEventListener('keydown', function(e){
    if(e.key === '/' && document.activeElement !== search &&
       !/^(INPUT|TEXTAREA)$/.test(document.activeElement.tagName)){
      e.preventDefault(); search.focus();
    }
    if((e.metaKey || e.ctrlKey) && e.key === 'k'){ e.preventDefault(); search.focus(); search.select(); }
  });

  /* ── 목차 하이라이트 ─────────────────────────────── */
  var spyTargets = [];
  function spy(){
    var active = document.querySelector('.doc.active');
    spyTargets = active ? [].slice.call(active.querySelectorAll('h2[id]')) : [];
    onScroll();
  }
  function onScroll(){
    body.classList.toggle('scrolled', window.scrollY > 4);
    if(!spyTargets.length) return;
    var cur = spyTargets[0];
    for(var i=0;i<spyTargets.length;i++){
      if(spyTargets[i].getBoundingClientRect().top <= 120) cur = spyTargets[i];
    }
    document.querySelectorAll('.toc a').forEach(function(a){
      a.classList.toggle('active', a.dataset.anchor === cur.id);
    });
  }
  window.addEventListener('scroll', onScroll, {passive:true});

  /* ── 사이드바 접기 · 본문 너비 ───────────────────── */
  function persist(key, on, cls){
    body.classList.toggle(cls, on);
    try { localStorage.setItem(key, on ? '1' : '0'); } catch(err){}
  }
  var collapsed = false, wide = false;
  try {
    collapsed = localStorage.getItem('docs-sb') === '1';
    wide = localStorage.getItem('docs-wide') === '1';
  } catch(err){}
  body.classList.toggle('sb-collapsed', collapsed);
  body.classList.toggle('wide', wide);

  var widthBtn = document.getElementById('widthBtn');
  widthBtn.setAttribute('aria-pressed', wide ? 'true' : 'false');
  widthBtn.addEventListener('click', function(){
    wide = !wide;
    persist('docs-wide', wide, 'wide');
    widthBtn.setAttribute('aria-pressed', wide ? 'true' : 'false');
  });

  function setCollapsed(v){
    collapsed = v;
    persist('docs-sb', collapsed, 'sb-collapsed');
  }
  document.getElementById('collapseBtn').addEventListener('click', function(){ setCollapsed(true); });
  document.getElementById('revealBtn').addEventListener('click', function(){ setCollapsed(false); });

  document.getElementById('menuBtn').addEventListener('click', function(){
    body.classList.toggle('nav-open');
  });
  document.getElementById('scrim').addEventListener('click', function(){
    body.classList.remove('nav-open');
  });

  /* ── 테마 ────────────────────────────────────────── */
  var KEY = 'docs-theme';
  var saved = null;
  try { saved = localStorage.getItem(KEY); } catch(err){}
  if(saved) document.documentElement.dataset.theme = saved;
  else if(window.matchMedia('(prefers-color-scheme: dark)').matches)
    document.documentElement.dataset.theme = 'dark';
  document.getElementById('themeBtn').addEventListener('click', function(){
    var next = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
    document.documentElement.dataset.theme = next;
    try { localStorage.setItem(KEY, next); } catch(err){}
  });

  fromHash();
})();
`;

/* ================================================================== *
 * 커맨드
 * ================================================================== */

function report({ errors, warnings }) {
  const byFile = new Map();
  for (const e of errors) {
    if (!byFile.has(e.file)) byFile.set(e.file, []);
    byFile.get(e.file).push(e.msg);
  }
  for (const [file, msgs] of byFile) {
    console.error("✗ " + file);
    for (const m of msgs) console.error("    " + m);
  }
  if (warnings.length) {
    const wByFile = new Map();
    for (const w of warnings) {
      if (!wByFile.has(w.file)) wByFile.set(w.file, []);
      wByFile.get(w.file).push(w.msg);
    }
    for (const [file, msgs] of wByFile) {
      console.warn("⚠ " + file);
      for (const m of msgs.slice(0, 6)) console.warn("    " + m);
      if (msgs.length > 6) console.warn("    … 외 " + (msgs.length - 6) + "건");
    }
  }
}

function cmdCheck(docsDir, quiet = false) {
  const docs = loadDocs(docsDir);
  const discovery = loadDiscovery(docsDir);
  const design = loadDesign(docsDir);
  const build = loadBuild(docsDir);
  const extra = [...discovery, ...design, ...build];
  const extraIds = new Set(extra.map((d) => d.id));

  const result = validate(docs, extraIds);
  const knownIds = new Set([...docs.map((d) => d.id), ...extraIds]);

  // 추적 ID 는 단계와 무관하게 하나의 풀로 본다
  const definedIds = new Set();
  for (const d of [...docs, ...extra]) {
    for (const id of d.refs.defined) definedIds.add(id);
  }
  result.errors.push(...validateDiscovery(extra, knownIds, definedIds));

  // 3단계 검증은 --deep 과 무관하게 항상 돈다. 잊는 것이 이 단계의 실패 모드다.
  const mockupsForReview = loadMockups(docsDir);
  result.warnings.push(...designReview(docsDir, design, mockupsForReview, docs));
  result.warnings.push(...buildReview(docsDir, build, docs));

  // 2단계 검증이 1·3단계에서 정의된 ID를 모르고 낸 오류는 걷어낸다
  for (const d of extra) {
    for (const id of d.refs.defined) {
      result.errors = result.errors.filter(
        (e) => e.msg !== "정의되지 않은 추적 ID: " + id,
      );
    }
  }
  report(result);
  if (result.errors.length) {
    console.error("\n" + result.errors.length + "건 실패 — 빌드 중단");
    return { ok: false, docs, discovery, design, build };
  }
  if (process.argv.includes("--deep")) {
    const notes = deepReview(docs, discovery, design, mockupsForReview, docsDir);
    if (notes.length) {
      const byFile = new Map();
      for (const n of notes) {
        if (!byFile.has(n.file)) byFile.set(n.file, []);
        byFile.get(n.file).push(n.msg);
      }
      console.log("\n품질 점검 — " + notes.length + "건 (빌드를 막지 않습니다)");
      for (const [file, msgs] of byFile) {
        console.log("  " + file);
        for (const m of msgs) console.log("      " + m);
      }
      console.log("");
    } else {
      console.log("품질 점검 — 지적사항 없음");
    }
  }

  if (!quiet) {
    console.log(
      "검증 통과 — 문서 " +
        docs.length +
        "개" +
        (discovery.length ? ", 1단계 기록 " + discovery.length + "개" : "") +
        (design.length ? ", 3단계 기록 " + design.length + "개" : "") +
        (result.warnings.length ? ", 경고 " + result.warnings.length + "건" : ""),
    );
  }
  return { ok: true, docs, discovery, design, build };
}

function cmdBuild(docsDir) {
  const { ok, docs, discovery, design, build } = cmdCheck(docsDir, true);
  if (!ok) process.exit(1);

  // 시안이 바뀌었으면 이전 판을 남긴다. 되돌릴 수 없는 손실을 막는 가장 싼 방법.
  const snapped = snapshotMockups(docsDir);
  if (snapped.length) {
    console.log("시안 스냅샷 " + snapped.length + "건: " + snapped.join(", "));
  }

  // 인라인 스크립트는 템플릿 리터럴 안에 있어서 백슬래시가 조용히 먹힌다.
  // 파싱만 해보면(실행하지 않는다) 그런 사고를 빌드에서 잡을 수 있다.
  try {
    new Function(JS);
  } catch (e) {
    console.error("인라인 스크립트 문법 오류: " + e.message);
    console.error("JS 상수 안의 이스케이프를 확인하세요 (\\/ 는 템플릿 리터럴에서 / 로 바뀝니다)");
    process.exit(1);
  }

  const config = loadConfig(docsDir);
  const mockups = loadMockups(docsDir);
  const styleguide = findStyleguide(docsDir);
  const links = loadLinks(docsDir, config, docs);
  const trace = buildTraceability([...discovery, ...design, ...docs]);
  const out = join(docsDir, "index.html");
  writeFileSync(out, render(docs, config, trace, discovery, design, mockups, styleguide, docsDir, build, links), "utf8");
  console.log(
    "생성됨: " +
      out +
      "  (문서 " +
      docs.length +
      "개" +
      (discovery.length ? ", 1단계 기록 " + discovery.length + "개" : "") +
      (design.length ? ", 3단계 기록 " + design.length + "개" : "") +
      (mockups.length ? ", 시안 " + mockups.length + "개" : "") +
      (styleguide ? ", 스타일 가이드" : "") +
      ", 추적 ID " +
      trace.owners.size +
      "개)",
  );
}

function cmdInit(docsDir) {
  const presetName = arg("preset");
  const moduleArg = arg("modules");
  const projectName = arg("name", "Project");
  const ai = arg("ai", process.env.PROJECT_AI || "미확인");
  const account = arg("account", process.env.PROJECT_ACCOUNT || "미확인");
  const existingCfg = existsSync(join(docsDir, "docs.config.json"))
    ? JSON.parse(readFileSync(join(docsDir, "docs.config.json"), "utf8"))
    : null;
  const profile = normalizeProfile({
    scale: arg("scale", existingCfg?.profile?.scale),
    risk: arg("risk", existingCfg?.profile?.risk),
    delivery: arg("delivery", existingCfg?.profile?.delivery),
  });

  let preset;
  if (moduleArg) {
    const names = moduleArg.split(",").map((x) => x.trim()).filter(Boolean);
    if (!names.includes("core")) names.unshift("core"); // core 는 항상 필요하다
    preset = { name: "custom", modules: names, exclude: [], options: [] };
  } else if (presetName) {
    const presetPath = join(SKILL_DIR, "presets", presetName + ".json");
    if (!existsSync(presetPath)) {
      console.error("없는 프리셋: " + presetName);
      process.exit(1);
    }
    preset = JSON.parse(readFileSync(presetPath, "utf8"));
  } else {
    console.error(
      "--preset=<이름> 또는 --modules=<a,b,c> 가 필요합니다.\n" +
        "  프리셋 목록: build.mjs presets\n  모듈 목록  : build.mjs modules",
    );
    process.exit(1);
  }

  preset.docs = resolveDocs(preset.modules, preset.exclude, profile);
  preset.refs = resolveRefs(preset.docs);
  if (!preset.refs.risk) {
    console.error("모듈 조합에 role:risk 문서가 없습니다 — core 모듈이 필요합니다");
    process.exit(1);
  }

  mkdirSync(docsDir, { recursive: true });
  mkdirSync(join(docsDir, INTAKE_DIR, PROCESSED_DIR), { recursive: true });

  // 기존 docs.config.json 의 옵션 선택을 존중한다. 없으면 프리셋 기본값.
  const existing = existsSync(join(docsDir, "docs.config.json"))
    ? loadConfig(docsDir)
    : null;
  const options = existing?.options || defaultOptions(preset);

  let created = 0;
  let skipped = 0;
  let omitted = 0;
  for (const entry of preset.docs) {
    const file = entry.file || entry.id + ".md";
    const path = join(docsDir, file);
    if (existsSync(path)) {
      skipped += 1;
      continue;
    }
    // 논점이 전부 꺼졌으면 그 문서는 이번 프로젝트에 필요 없다
    if (entry.outline && !activeOutline(entry.outline, options).length) {
      omitted += 1;
      continue;
    }
    const tmpl = readFileSync(
      join(SKILL_DIR, "templates", entry.template + ".md"),
      "utf8",
    );
    let filled = tmpl
      .replace(/\{\{id\}\}/g, entry.id)
      .replace(/\{\{title\}\}/g, entry.title)
      .replace(/\{\{phase\}\}/g, entry.phase)
      .replace(/\{\{summary\}\}/g, entry.summary)
      .replace(/\{\{updated\}\}/g, today())
      .replace(/\{\{timestamp\}\}/g, nowMinute())
      .replace(/\{\{ai\}\}/g, ai)
      .replace(/\{\{account\}\}/g, account)
      .replace(/\{\{riskDoc\}\}/g, preset.refs?.risk || entry.id)
      .replace(/\{\{decisionDoc\}\}/g, preset.refs?.decision || entry.id)
      .replace(/\{\{outline\}\}/g, renderOutline(entry.outline, options));

    if (entry.template === "spec") filled = numberSections(filled);
    writeFileSync(path, filled, "utf8");
    created += 1;
  }

  const configPath = join(docsDir, "docs.config.json");
  if (!existsSync(configPath)) {
    writeFileSync(
      configPath,
      JSON.stringify(
        { project: projectName, preset: presetName, options, profile },
        null,
        2,
      ) + "\n",
      "utf8",
    );
  }

  console.log(
    "초기화 완료: " +
      docsDir +
      "  (생성 " +
      created +
      "개" +
      (skipped ? ", 기존 유지 " + skipped + "개" : "") +
      (omitted ? ", 옵션 제외 " + omitted + "개" : "") +
      ")",
  );
  console.log("다음: node " + join(SKILL_DIR, "build.mjs") + " build");
}

/* ================================================================== *
 * 기획안 흡수 (intake)
 *
 * 원본 기획안을 Docs/_intake/ 에 넣으면 미처리 대기 상태가 된다.
 * 분석과 문서 작성은 에이전트가 한다 (SKILL.md 절차). 이 명령은
 * 대기 목록 확인과 처리 완료 보관만 담당한다.
 *
 * 종료 코드가 곧 게이트다 — 대기 파일이 있으면 0, 없으면 1.
 * Orca automation 의 --precheck 로 그대로 쓸 수 있다.
 * ================================================================== */

const INTAKE_DIR = "_intake";
const PROCESSED_DIR = "processed";
const DISCOVERY_DIR = "_discovery";
const DESIGN_DIR = "_design";
const MOCKUP_DIR = "mockups";
const BUILD_DIR = "_build";
const HISTORY_DIR = ".history";
const DESIGN_IMG_DIR = "images";

function intakePaths(docsDir) {
  const root = join(docsDir, INTAKE_DIR);
  return { root, processed: join(root, PROCESSED_DIR) };
}

function pendingIntake(docsDir) {
  const { root } = intakePaths(docsDir);
  if (!existsSync(root)) return [];
  return readdirSync(root, { withFileTypes: true })
    .filter((e) => e.isFile() && /\.(md|markdown|txt)$/i.test(e.name))
    .map((e) => e.name)
    .sort();
}

function cmdIntake(docsDir) {
  const { root, processed } = intakePaths(docsDir);
  const archive = arg("archive");
  const quiet = process.argv.includes("--quiet");

  if (archive) {
    const from = join(root, archive);
    if (!existsSync(from)) {
      console.error("없는 파일: " + from);
      process.exit(1);
    }
    // 처리된 기획안은 1단계 기록 폴더로 옮겨 HTML에서 계속 볼 수 있게 한다
    const dest = join(docsDir, DISCOVERY_DIR);
    mkdirSync(dest, { recursive: true });
    const to = join(dest, archive);
    renameSync(from, to);
    console.log("1단계 기록으로 이동: " + to);
    return;
  }

  const pending = pendingIntake(docsDir);
  if (!pending.length) {
    if (!quiet) console.log("대기 중인 기획안 없음 (" + root + ")");
    process.exit(1);
  }
  if (!quiet) {
    console.log("미처리 기획안 " + pending.length + "건:");
    for (const f of pending) console.log("  " + join(root, f));
  } else {
    console.log(pending.length);
  }
  process.exit(0);
}

/**
 * 프리셋의 outline(문서별 논점)을 빈 섹션으로 펼친다.
 *
 * 이것이 플랫폼이 도메인 지식을 축적하는 방식이다. 구조만 주면 새 프로젝트마다
 * "이 문서에 뭘 써야 하지"를 매번 다시 떠올려야 하고, 기획안에 없는 주제는
 * 영원히 누락된다. 빈 섹션이 있으면 안 채운 것이 눈에 보인다.
 *
 * outline 항목은 [제목, 작성지침] 또는 "제목" 형식.
 */
/* ================================================================== *
 * 범위 옵션
 *
 * 프로젝트마다 켜고 끄는 것이 달라지는 항목(SEO, GEO, 애널리틱스, 다국어 …)을
 * 프리셋이 카탈로그로 들고 있는다. 에이전트가 흡수 단계에서 사용자에게 묻고,
 * 답을 docs.config.json 에 적으면 init 이 그 선택대로 문서를 만든다.
 *
 * 목적은 "나중에 왜 이게 없지"를 없애는 것이다. 선택은 기록으로 남는다.
 * ================================================================== */

/* ================================================================== *
 * 모듈 조합
 *
 * 프리셋은 문서 목록을 직접 들지 않고 **모듈 조합**만 선언한다.
 * 새 프로젝트 유형이 생겨도 문서 정의를 복제하지 않고 모듈만 고르면 된다.
 * 프리셋이 없는 유형은 `--modules=core,product,ops` 처럼 직접 조합할 수 있다.
 * ================================================================== */

function loadModule(name) {
  const path = join(SKILL_DIR, "modules", name + ".json");
  if (!existsSync(path)) {
    console.error("없는 모듈: " + name + "  (목록: build.mjs modules)");
    process.exit(1);
  }
  return JSON.parse(readFileSync(path, "utf8"));
}

/**
 * 모듈들을 펼쳐 문서 목록을 만든다.
 * 번호는 여기서 매긴다 — 단계(phase) 순서를 먼저 따르므로 조합이 달라져도
 * 사이드바가 01 전략 → 06 관리 흐름을 유지한다.
 */
/* 프로젝트 프로필 축 — 낮은 쪽이 작은 프로젝트다.
 * 문서의 min* 값이 프로젝트 값보다 높으면 그 문서는 만들지 않는다.
 * 축을 늘리려면 여기와 modules/*.json 만 고치면 된다. */
const PROFILE_AXES = {
  scale: ["solo", "small", "standard", "large"],
  risk: ["low", "standard", "regulated"],
  delivery: ["prototype", "mvp", "production"],
};
const PROFILE_DEFAULT = { scale: "large", risk: "regulated", delivery: "production" };

/** 프로필 값을 정규화한다. 모르는 값은 기본값(가장 넓은 범위)으로 둔다. */
function normalizeProfile(profile = {}) {
  const out = {};
  for (const [axis, levels] of Object.entries(PROFILE_AXES)) {
    const v = profile[axis];
    out[axis] = levels.includes(v) ? v : PROFILE_DEFAULT[axis];
  }
  return out;
}

/** 문서가 이 프로필에서 필요한가. min* 이 없으면 항상 포함한다. */
function docInProfile(doc, profile) {
  for (const [axis, levels] of Object.entries(PROFILE_AXES)) {
    const need = doc["min" + axis[0].toUpperCase() + axis.slice(1)];
    if (!need) continue;
    if (!levels.includes(need)) continue; // 오타는 무시한다 — 문서를 잃는 것보다 낫다
    if (levels.indexOf(profile[axis]) < levels.indexOf(need)) return false;
  }
  return true;
}

function resolveDocs(moduleNames, exclude = [], profile) {
  const p = normalizeProfile(profile);
  const skip = new Set(exclude);
  const collected = [];
  moduleNames.forEach((m, mi) => {
    loadModule(m).docs.forEach((d, di) => {
      if (skip.has(d.name)) return;
      if (!docInProfile(d, p)) return;
      if (collected.some((c) => c.name === d.name)) return; // 모듈 간 중복 제거
      collected.push({ ...d, _m: mi, _d: di });
    });
  });

  collected.sort((a, b) =>
    (a.phase || "").localeCompare(b.phase || "") ||
    a._m - b._m ||
    a._d - b._d,
  );

  return collected.map((d, i) => {
    const num = String(i).padStart(2, "0");
    const { _m, _d, ...rest } = d;
    return { ...rest, id: num + "-" + d.name };
  });
}

/** role 로 표시된 문서에서 템플릿 참조를 계산한다. */
function resolveRefs(docs) {
  const find = (role) => docs.find((d) => d.role === role);
  return {
    risk: find("risk")?.id || "",
    decision: find("decision")?.id || "",
  };
}

function cmdModules() {
  const dir = join(SKILL_DIR, "modules");
  for (const f of readdirSync(dir).filter((x) => x.endsWith(".json")).sort()) {
    const m = JSON.parse(readFileSync(join(dir, f), "utf8"));
    console.log(m.name.padEnd(13) + m.label);
    console.log(" ".repeat(13) + m.docs.map((d) => d.name).join(", "));
  }
  console.log(
    "\n프리셋 없이 조합: build.mjs init --modules=core,product,ops --name=\"이름\"",
  );
}

function defaultOptions(preset) {
  const out = {};
  for (const o of preset.options || []) out[o.id] = o.default !== false;
  return out;
}

function csvArg(name) {
  return (arg(name, "") || "").split(",").map((x) => x.trim()).filter(Boolean);
}

function cmdConfigure(docsDir) {
  const currentPath = join(docsDir, "docs.config.json");
  const current = existsSync(currentPath) ? JSON.parse(readFileSync(currentPath, "utf8")) : {};
  const presetName = arg("preset", current.preset || "web-corporate");
  const presetPath = join(SKILL_DIR, "presets", presetName + ".json");
  if (!existsSync(presetPath)) throw new Error("없는 프리셋: " + presetName);
  const preset = JSON.parse(readFileSync(presetPath, "utf8"));
  const options = { ...defaultOptions(preset), ...(current.options || {}) };
  const known = new Set((preset.options || []).map((o) => o.id));
  for (const id of csvArg("enable")) {
    if (!known.has(id)) throw new Error("없는 옵션: " + id);
    options[id] = true;
  }
  for (const id of csvArg("disable")) {
    if (!known.has(id)) throw new Error("없는 옵션: " + id);
    options[id] = false;
  }
  if (options.adtracking && !options.consent) throw new Error("adtracking을 켜려면 consent도 켜야 합니다");
  mkdirSync(docsDir, { recursive: true });
  const modes = { ...(current.modes || {}) };
  if (arg("contact-mode")) modes.contactform = arg("contact-mode");
  const profile = normalizeProfile({
    scale: arg("scale", current.profile?.scale),
    risk: arg("risk", current.profile?.risk),
    delivery: arg("delivery", current.profile?.delivery),
  });
  writeFileSync(currentPath, JSON.stringify({ ...current, project: arg("name", current.project || "Project"), preset: presetName, options, modes, profile }, null, 2) + "\n");
  console.log("  프로필: scale=" + profile.scale + " risk=" + profile.risk + " delivery=" + profile.delivery);
  console.log("설정됨: " + currentPath);
}

function cmdReady(docsDir) {
  const phase = arg("phase");
  if (!phase) throw new Error("--phase=design|implementation|release 가 필요합니다");
  const risks = loadDocs(docsDir).filter((d) => d.meta.template === "register");
  const blocked = risks.flatMap((d) => [...d.body.matchAll(/^###\s+([BHM]-\d+).*?[\s\S]*?\|\s*\*\*차단 단계\*\*\s*\|\s*([^|\n]+).*?[\s\S]*?\|\s*\*\*상태\*\*\s*\|\s*([^|\n]+)/gm)])
    .filter((m) => m[2].trim() === phase && !/^(해소|완료)(?:\s|$)/.test(m[3].trim()))
    .map((m) => m[1]);
  if (blocked.length) {
    console.error("진입 불가 — " + phase + " 차단 리스크: " + blocked.join(", "));
    process.exit(1);
  }
  console.log("진입 가능: " + phase);
}

function cmdOptions(docsDir) {
  const presetName =
    arg("preset") || (existsSync(docsDir) ? loadConfig(docsDir).preset : null);
  if (!presetName) {
    console.error("--preset=<이름> 이 필요합니다. 목록: build.mjs presets");
    process.exit(1);
  }
  const path = join(SKILL_DIR, "presets", presetName + ".json");
  if (!existsSync(path)) {
    console.error("없는 프리셋: " + presetName);
    process.exit(1);
  }
  const preset = JSON.parse(readFileSync(path, "utf8"));
  const current = existsSync(docsDir) ? loadConfig(docsDir).options : null;

  if (process.argv.includes("--json")) {
    console.log(
      JSON.stringify(
        { preset: presetName, options: preset.options || [], current },
        null,
        2,
      ),
    );
    return;
  }

  console.log("프리셋: " + presetName + "\n");
  for (const o of preset.options || []) {
    const state = current ? (current[o.id] === false ? "끔" : "켬") : "-";
    const def = o.default === false ? "기본 끔" : "기본 켬";
    console.log("  [" + state + "] " + o.id.padEnd(13) + o.label + "  (" + def + ")");
    if (o.detail) console.log("        " + o.detail);
  }
}

/**
 * outline 항목은 [제목, 작성지침, 옵션id] 또는 "제목".
 * 옵션 id가 붙은 항목은 그 옵션이 켜져 있을 때만 살아남는다.
 * 태그가 없는 항목은 항상 포함된다.
 */
function activeOutline(outline, options) {
  if (!outline) return [];
  return outline.filter((entry) => {
    const opt = Array.isArray(entry) ? entry[2] : null;
    return !opt || options[opt] !== false;
  });
}

function renderOutline(outline, options = {}) {
  const active = activeOutline(outline, options);
  if (!active.length) return "## 정의\n\n본문.";
  return active
    .map((entry) => {
      const [title, hint] = Array.isArray(entry) ? entry : [entry, null];
      return (
        "## " + title + "\n\n" + (hint ? "> **작성 지침** — " + hint + "\n" : "")
      );
    })
    .join("\n");
}

/** `## ` 헤딩에 순번을 매긴다. 코드펜스 안은 건드리지 않는다. */
function numberSections(md) {
  let n = 0;
  return md
    .split(/(```[\s\S]*?```)/g)
    .map((chunk, i) =>
      i % 2 === 1
        ? chunk
        : chunk.replace(/^## (?!\d+\.\s)(.+)$/gm, (_, t) => "## " + ++n + ". " + t),
    )
    .join("");
}

/* ================================================================== *
 * 스킬 평가 (eval)
 *
 * selftest 가 빌더를 검증한다면 이쪽은 **스킬 지시가 지켜졌는지**를 본다.
 * 기계가 확정할 수 있는 것만 여기서 판정하고, 판단이 필요한 항목은
 * evals/RUBRIC.md 로 넘겨 사람·에이전트가 채점하게 한다.
 * 애매한 것까지 자동 통과 처리하면 평가가 거짓 안심을 준다.
 * ================================================================== */

function cmdEval(docsDir) {
  const name = arg("case");
  const dir = join(SKILL_DIR, "evals", "cases");
  if (!name) {
    console.log("케이스:");
    for (const f of readdirSync(dir).filter((x) => x.endsWith(".expect.json")).sort()) {
      const e = JSON.parse(readFileSync(join(dir, f), "utf8"));
      console.log("  " + e.case.padEnd(14) + (e.note || ""));
    }
    console.log("\n사용: build.mjs eval --case=<이름> [--docs=<경로>]");
    return;
  }
  const path = join(dir, name + ".expect.json");
  if (!existsSync(path)) {
    console.error("없는 케이스: " + name);
    process.exit(1);
  }
  const exp = JSON.parse(readFileSync(path, "utf8"));
  const docs = loadDocs(docsDir);
  const discovery = loadDiscovery(docsDir);
  const design = loadDesign(docsDir);
  const config = loadConfig(docsDir);
  const all = [...docs, ...discovery, ...design];
  const blob = all.map((d) => d.body).join("\n");

  const results = [];
  const check = (label, pass, detail) => results.push({ label, pass, detail });

  if (exp.preset) {
    check("프리셋 = " + exp.preset, config.preset === exp.preset, "실제: " + config.preset);
  }

  const defined = new Set();
  for (const d of all) for (const id of d.refs.defined) defined.add(id);
  const blockers = [...defined].filter((i) => i.startsWith("B-")).length;
  if (exp.minBlockers != null) {
    check("Blocker ≥ " + exp.minBlockers, blockers >= exp.minBlockers, "실제: " + blockers + "건");
  }

  const todos = (blob.match(/TODO\([a-z]+\)/g) || []).length;
  if (exp.minTodos != null) {
    check("TODO ≥ " + exp.minTodos, todos >= exp.minTodos, "실제: " + todos + "건");
  }

  if (exp.noLeftoverPlaceholders) {
    const left = all.filter((d) => /\{\{[^}]+\}\}/.test(d.body)).map((d) => d.file);
    check("자리표시자 없음", left.length === 0, left.join(", "));
  }

  if (exp.noOutcomeClaims) {
    const found = [];
    for (const d of all) {
      for (const c of outcomeClaims(stripCode(d.body))) found.push(d.file + ":" + c);
    }
    check("근거 없는 성과 수치 없음", found.length === 0, found.slice(0, 4).join(", "));
  }

  if (exp.requireOptionsRecorded) {
    const n = config.options ? Object.keys(config.options).length : 0;
    check("범위 옵션 기록됨", n > 0, n + "개");
  }

  for (const opt of exp.expectOptionsOff || []) {
    const v = config.options ? config.options[opt] : undefined;
    check("옵션 " + opt + " = 끔", v === false, "실제: " + String(v));
  }

  for (const word of exp.mustMentionUndecided || []) {
    const hit = all.some(
      (d) => d.body.includes(word) && /미결정|TODO\(|미정|확정 필요/.test(d.body),
    );
    check("'" + word + "' 를 미결정으로 남김", hit, "");
  }

  const pass = results.filter((r) => r.pass).length;
  console.log("케이스: " + exp.case + (exp.note ? "  — " + exp.note : "") + "\n");
  for (const r of results) {
    console.log("  " + (r.pass ? "✓" : "✗") + " " + r.label + (r.detail ? "   " + r.detail : ""));
  }
  console.log("\n기계 판정: " + pass + "/" + results.length);

  const human = exp.humanCheck || [];
  console.log("\n사람이 채점할 항목" + (human.length ? "" : " — RUBRIC.md 참조"));
  for (const h of human) console.log("  □ " + h);
  console.log("  □ RUBRIC.md 의 공통 무결성 C1~C4");
  console.log("\n※ 기계 판정 통과가 곧 합격이 아니다. RUBRIC.md 를 함께 채점한다.");

  if (pass < results.length) process.exitCode = 1;
}

function cmdPresets() {
  const dir = join(SKILL_DIR, "presets");
  for (const f of readdirSync(dir).filter((x) => x.endsWith(".json")).sort()) {
    const p = JSON.parse(readFileSync(join(dir, f), "utf8"));
    console.log(
      p.name.padEnd(18) + p.label + "  (문서 " + resolveDocs(p.modules, p.exclude).length + "개)",
    );
    console.log(" ".repeat(18) + p.description);
  }
}

/* ================================================================== *
 * 자체 점검
 * ================================================================== */

function selftest() {
  let failed = 0;
  const assert = (cond, msg) => {
    if (!cond) {
      console.error("FAIL: " + msg);
      failed += 1;
    }
  };
  const h = (md, o) => mdToHtml(md, o || {}).html;

  // 마크다운
  assert(h("# 제목").startsWith('<h1 id="제목">제목</h1>'), "heading + id");
  assert(mdToHtml("## 섹션").headings.length === 1, "h2 collected");
  assert(h("본문") === "<p>본문</p>", "paragraph");
  assert(h("- a\n- b") === "<ul><li>a</li><li>b</li></ul>", "list");
  assert(h("- [x] 완료").includes("disabled checked>"), "task checked");
  assert(h("---") === "<hr>", "hr");
  assert(h("> 인용").includes("<blockquote><p>인용</p></blockquote>"), "quote");
  assert(h("```js\nvar a=1;\n```").includes("<pre><code"), "code fence");
  assert(h("`a<b`").includes("<code>a&lt;b</code>"), "inline code escaped");
  assert(h("**굵게**").includes("<strong>굵게</strong>"), "bold");
  assert(!h("텍스트 <script>").includes("<script>"), "html escaped");
  assert(!h('그는 "use client"라고 썼다').includes('"'), "double quote escaped");
  assert(!h("don't").includes("'"), "single quote escaped");

  const table = h("| a | b |\n| --- | --- |\n| 1 | 2 |");
  assert(table.includes("<th>a</th>") && table.includes("<td>2</td>"), "table");
  const escaped = h("| k | v |\n| --- | --- |\n| t | `x \\| y` |");
  assert(
    escaped.includes("<code>x | y</code>") &&
      (escaped.match(/<td>/g) || []).length === 2,
    "escaped pipe stays in one cell",
  );
  assert(!h("| | |\n| --- | --- |\n| k | v |").includes("<thead>"), "empty header omitted");
  assert(
    mdToHtml("## 같은 제목\n\n## 같은 제목").html.includes('id="같은-제목-2"'),
    "unique heading ids",
  );
  const toggled = h("## 2026-08-24\n\n### D-001. 결정\n\n본문", { dateToggles: true });
  assert(toggled.includes('<details class="log-date">') && toggled.endsWith("</div></details>"), "date headings become toggles");

  // 위키링크
  const resolveLink = (t) => (t === "04-prd" ? { id: "04-prd", title: "PRD" } : null);
  const wl = h("[[04-prd]] 참조", { resolveLink });
  assert(wl.includes('href="#/04-prd"') && wl.includes(">PRD<"), "wikilink resolves to title");
  assert(h("[[04-prd|요구사항]]", { resolveLink }).includes(">요구사항<"), "wikilink label");
  assert(h("[[없는문서]]", { resolveLink }).includes("broken"), "broken wikilink marked");

  // 참조 수집
  const refs = scanReferences(
    "### B-01. 로고 없음\n\n| F-01 | 헤더 | M |\n\n본문에서 D-002 를 언급한다. B2B 는 ID가 아니다.",
  );
  assert(refs.defined.has("B-01"), "heading defines id");
  assert(refs.defined.has("F-01"), "table first cell defines id");
  assert(refs.mentioned.has("D-002"), "mention collected");
  assert(!refs.defined.has("D-002"), "mention is not a definition");
  assert(![...refs.mentioned].some((x) => x.startsWith("B2")), "B2B not treated as id");

  // 코드 안의 표기는 예시이지 참조가 아니다 (표기법을 설명하는 문서가 스스로 깨지지 않도록)
  const inCode = scanReferences(
    "표기: `[[문서-id]]` 와 `B-01` 을 쓴다.\n\n```\n[[또다른문서]]\nF-99\n```",
  );
  assert(inCode.wikiLinks.size === 0, "wikilink inside code is not a reference");
  assert(inCode.mentioned.size === 0, "id inside code is not a reference");

  // outline — 프리셋의 도메인 논점이 빈 섹션으로 펼쳐지는가
  const ol = renderOutline([["네이버 대응", "서치어드바이저 등록"], "GEO"]);
  assert(ol.includes("## 네이버 대응"), "outline renders heading");
  assert(ol.includes("**작성 지침** — 서치어드바이저 등록"), "outline renders hint");
  assert(ol.includes("## GEO"), "outline accepts bare string");
  assert(renderOutline([]).includes("## 정의"), "empty outline falls back");

  // 성과 수치 탐지 — 스펙 수치를 잡으면 안 된다
  assert(outcomeClaims("텍스트 200% 확대 시 손실 없음").length === 0, "spec threshold not flagged");
  assert(outcomeClaims("본문 90% 스크롤 시 이벤트").length === 0, "event threshold not flagged");
  assert(outcomeClaims("문의 전환율이 30% 증가했습니다").length === 1, "outcome claim flagged");
  assert(outcomeClaims("사용자 5만 명 달성").length >= 1, "user-count claim flagged");

  // 모듈 조합 — 프리셋 없이도 문서 목록이 만들어지는가
  const only = resolveDocs(["core"]);
  assert(only.length >= 4, "core module resolves docs");
  assert(
    only.every((d, i) => d.id.startsWith(String(i).padStart(2, "0") + "-")),
    "ids are numbered sequentially",
  );
  const phases = only.map((d) => d.phase);
  assert(
    phases.every((v, i) => i === 0 || phases[i - 1] <= v),
    "docs are ordered by phase",
  );
  const coreRefs = resolveRefs(only);
  assert(coreRefs.risk && coreRefs.decision, "refs resolved from role markers");
  assert(
    only.some((d) => d.id === coreRefs.risk),
    "risk ref points at a doc that exists",
  );
  // 프로필 축 — 작은 프로젝트는 문서가 줄어야 한다
  const large = resolveDocs(["core", "backend"], [], { scale: "large", risk: "regulated" });
  const solo = resolveDocs(["core", "backend"], [], { scale: "solo", risk: "low" });
  assert(solo.length < large.length, "작은 프로필이 문서를 줄인다");
  assert(
    !solo.some((d) => d.name === "api-spec"),
    "minScale=standard 문서는 solo 에서 빠진다",
  );
  assert(
    solo.some((d) => d.name === "project-brief"),
    "min* 없는 문서는 어떤 프로필에서도 남는다",
  );
  assert(
    !resolveDocs(["backend"], [], { risk: "low" }).some((d) => d.name === "security-audit"),
    "minRisk=regulated 문서는 low 에서 빠진다",
  );
  assert(
    resolveDocs(["core"], [], { scale: "존재하지않음" }).length ===
      resolveDocs(["core"], [], {}).length,
    "모르는 프로필 값은 기본값으로 넘어간다",
  );

  const combined = resolveDocs(["core", "core", "ops"]);
  assert(
    new Set(combined.map((d) => d.name)).size === combined.length,
    "duplicate modules are deduped",
  );
  assert(
    !resolveDocs(["ops"], ["roadmap"]).some((d) => d.name === "roadmap"),
    "exclude removes a doc",
  );

  // 1단계 기록 — 가벼운 검증만 적용되는가
  const disc = [
    { file: "_discovery/a.md", id: "discovery-brief",
      refs: { wikiLinks: new Set(["04-prd"]), defined: new Set(["DI-001"]), mentioned: new Set() } },
    { file: "_discovery/b.md", id: "discovery-brief",
      refs: { wikiLinks: new Set(["없는문서"]), defined: new Set(), mentioned: new Set() } },
  ];
  const dErr = validateDiscovery(
    disc,
    new Set(["04-prd", "discovery-brief"]),
    new Set(["DI-001"]),
  )
    .map((e) => e.msg)
    .join(" | ");
  assert(dErr.includes("id 중복"), "discovery id 중복 catches");
  assert(dErr.includes("깨진 참조"), "discovery broken wikilink catches");
  assert(
    !dErr.includes("필수 섹션") && !dErr.includes("프론트매터 누락"),
    "discovery is exempt from spec-doc schema",
  );
  const refErr = validateDiscovery(
    [{ file: "_design/x.md", id: "design-x",
       refs: { wikiLinks: new Set(), defined: new Set(), mentioned: new Set(["ZZ-99"]) } }],
    new Set(["design-x"]),
    new Set(["DS-001"]),
  ).map((e) => e.msg).join(" | ");
  assert(
    refErr.includes("정의되지 않은 추적 ID: ZZ-99"),
    "stage records are NOT exempt from referential integrity",
  );

  // 범위 옵션 — 꺼진 항목의 섹션이 사라지는가
  const tagged = [
    ["항상", "언제나 포함", null],
    ["GEO", "생성형 AI 노출", "geo"],
    ["네이버", "서치어드바이저", "naver"],
  ];
  assert(activeOutline(tagged, {}).length === 3, "no config = all sections on");
  assert(
    activeOutline(tagged, { geo: false }).length === 2,
    "disabled option removes its section",
  );
  assert(
    activeOutline(tagged, { geo: false }).every((e) => e[2] !== "geo"),
    "the removed section is the tagged one",
  );
  assert(
    activeOutline(tagged, { geo: false, naver: false })[0][0] === "항상",
    "untagged sections always survive",
  );
  assert(
    activeOutline([["a", "h", "x"]], { x: false }).length === 0,
    "fully gated outline becomes empty (doc is skipped at init)",
  );

  const gated = renderOutline(tagged, { geo: false });
  assert(!gated.includes("## GEO"), "renderOutline honours options");
  assert(gated.includes("## 네이버"), "renderOutline keeps enabled sections");
  const progressSample = stageProgress(
    [{ meta: { status: "draft" } }, { meta: { status: "approved" } }],
    [{}], [], [], null, {},
  );
  assert(progressSample[1] === 100 && progressSample[2] === 63 && progressSample[3] === 0, "stage progress is derived from artifacts");

  // 3단계는 산출물이 있어도 승인 전에는 100 이 되지 않는다.
  // 예전 계산식은 시안 하나만 있으면 100 이었고, 그 뒤로 열세 번을 더 고쳤다.
  const rulesDraft = [{ id: "design-rules", meta: { status: "draft" } }];
  const rulesOk = [{ id: "design-rules", meta: { status: "approved" } }];
  assert(stage3Progress([], [], null, "") === 0, "stage3 starts at 0");
  assert(stage3Progress(rulesDraft, [{}], "sg.html", "") === 60, "stage3 without approval stays below 100");
  assert(stage3Progress(rulesOk, [{}], "sg.html", "") === 80, "stage3 approval adds weight");
  assert(
    stage3Progress(rulesOk, [{}], "sg.html", "") < 100,
    "stage3 cannot reach 100 without tone-options and audit",
  );
  assert(progressClass(0) === "p-gray" && progressClass(24) === "p-red" && progressClass(25) === "p-yellow" && progressClass(50) === "p-orange" && progressClass(100) === "p-green", "progress color thresholds");

  // 섹션 번호 자동 부여
  const numbered = numberSections("## 목적\n\n본문\n\n## 범위\n\n## 3. 이미번호");
  assert(numbered.includes("## 1. 목적"), "sections numbered from 1");
  assert(numbered.includes("## 2. 범위"), "sections numbered sequentially");
  assert(numbered.includes("## 3. 이미번호"), "already-numbered heading untouched");
  assert(
    !numberSections("```\n## 코드 안 헤딩\n```").includes("## 1."),
    "headings inside code fence are not numbered",
  );

  // 섹션 제목 정규화
  assert(normalizeSectionTitle("7. 미결정") === "미결정", "numbered section normalized");
  assert(normalizeSectionTitle("범위 제외 (`W`)") === "범위 제외", "trailing paren stripped");

  // 프론트매터
  const fm = parseFrontmatter("---\nid: x\ntitle: T\n---\n# H");
  assert(fm.found && fm.meta.id === "x" && fm.body.trim() === "# H", "frontmatter");
  assert(!parseFrontmatter("# H").found, "missing frontmatter detected");

  // 검증기 — 위반이 실제로 잡히는가
  const bad = [
    {
      file: "x.md",
      meta: {
        id: "01-x",
        title: "T",
        phase: "01. 전략",
        status: "aproved",
        owner: "o",
        summary: "s",
        template: "spec",
        updated: "2026/08/13",
      },
      body: "",
      hasFrontmatter: true,
      sections: [],
      refs: { wikiLinks: new Set(["없는문서"]), defined: new Set(), mentioned: new Set() },
      id: "01-x",
    },
  ];
  const r = validate(bad);
  const msgs = r.errors.map((e) => e.msg).join(" | ");
  assert(msgs.includes("status 값 오류"), "enum violation caught");
  assert(msgs.includes("updated 형식 오류"), "date pattern violation caught");
  assert(msgs.includes("필수 섹션 누락: 미결정"), "required section caught");
  assert(msgs.includes("필수 섹션 누락: 변경 이력"), "required section caught (2)");
  assert(msgs.includes("깨진 참조"), "broken wikilink caught");
  assert(msgs.includes("파일명이 id와 다릅니다"), "filename mismatch caught");

  if (failed) {
    console.error("\nselftest: " + failed + "건 실패");
    process.exit(1);
  }
  console.log("selftest: 모든 검사 통과");
}

/* ================================================================== *
 * 진입점
 * ================================================================== */

const command = process.argv[2] || "build";
const docsDir = resolve(arg("docs", "Docs"));

if (command === "selftest") {
  selftest();
} else if (command === "modules") {
  cmdModules();
} else if (command === "presets") {
  cmdPresets();
} else if (command === "eval") {
  cmdEval(docsDir);
} else if (command === "options") {
  cmdOptions(docsDir);
} else if (command === "configure") {
  cmdConfigure(docsDir);
} else if (command === "init") {
  cmdInit(docsDir);
} else if (!existsSync(docsDir)) {
  console.error("문서 디렉터리가 없습니다: " + docsDir);
  console.error("먼저 init 하세요: node build.mjs init --preset=web-corporate --name=\"프로젝트명\"");
  process.exit(1);
} else if (command === "intake") {
  cmdIntake(docsDir);
} else if (command === "check") {
  process.exit(cmdCheck(docsDir).ok ? 0 : 1);
} else if (command === "ready") {
  cmdReady(docsDir);
} else if (command === "build") {
  cmdBuild(docsDir);
} else {
  console.error("알 수 없는 명령: " + command);
  console.error("사용 가능: check | build | intake | options | configure | ready | eval | init | presets | modules | selftest");
  process.exit(1);
}
