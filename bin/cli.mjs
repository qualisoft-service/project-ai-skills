#!/usr/bin/env node
/**
 * @qualisoft/ai-skills — 스킬을 각 AI 도구가 찾는 자리에 놓는다.
 *
 * 스킬 자체는 마크다운과 node 내장 모듈만 쓰는 스크립트다. 따라서 도구마다
 * 다른 것은 **실행 방식이 아니라 발견 방식**뿐이다. 이 CLI 가 하는 일도
 * 그 하나다 — 도구가 보는 디렉터리에 링크를 걸거나, 스킬 목록을 지시문에 적는다.
 */
import {
  existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync,
  lstatSync, rmSync, symlinkSync, cpSync, realpathSync, readlinkSync,
} from "node:fs";
import { homedir, platform } from "node:os";
import { basename, join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const PKG_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const SKILLS_DIR = join(PKG_ROOT, "skills");
const HOME = homedir();
const VERSION = (() => {
  try {
    return JSON.parse(readFileSync(join(PKG_ROOT, "package.json"), "utf8")).version;
  } catch {
    return "unknown";
  }
})();

/* 스킬의 안정된 보관 위치.
 *
 * npx 는 패키지를 캐시(`_npx/<해시>/`)에 풀고, 그 캐시는 정리 대상이다.
 * 거기를 직접 링크하면 캐시가 비워지는 순간 모든 스킬이 죽은 링크가 된다.
 * 그래서 임시 위치에서 실행됐을 때는 먼저 여기로 복사해 두고, 도구들은
 * 이 경로를 가리키게 한다. */
const STORE = join(HOME, ".ai-skills", "qualisoft");

/** 패키지가 사라질 수 있는 위치에 있는가 (npx 캐시 · node_modules). */
function isTransient(dir) {
  return /[/\\](?:node_modules|_npx)[/\\]/.test(dir + "/");
}

/* ── 설치 대상 ──────────────────────────────────────────────────────
 * mode: "native" — 도구가 스킬 디렉터리를 직접 읽는다. 링크만 걸면 끝.
 * mode: "inject" — 스킬 개념이 없는 도구. 정본 위치를 지시문에 적는다.
 *
 * dir: null 인 대상은 스킬을 따로 놓지 않고 정본(SOURCE)을 그대로 가리킨다.
 * detect 는 자동 탐지에 쓰는 "이 도구가 설치되어 있나" 경로다.
 *
 * 경로가 바뀌면 여기만 고친다. verified 는 실제로 확인한 경로인지를 뜻한다. */
const TARGETS = [
  {
    id: "claude",
    label: "Claude Code",
    mode: "native",
    dir: join(HOME, ".claude", "skills"),
    detect: join(HOME, ".claude"),
    verified: true,
  },
  {
    id: "codex",
    label: "Codex CLI",
    mode: "native",
    dir: join(HOME, ".codex", "skills"),
    detect: join(HOME, ".codex"),
    verified: true,
  },
  {
    id: "gemini",
    label: "Gemini CLI",
    mode: "inject",
    dir: null,
    instructions: join(HOME, ".gemini", "GEMINI.md"),
    detect: join(HOME, ".gemini"),
    verified: false,
  },
  {
    id: "cursor",
    label: "Cursor",
    mode: "inject",
    dir: null,
    instructions: join(HOME, ".cursor", "rules", "qualisoft-ai-skills.mdc"),
    detect: join(HOME, ".cursor"),
    verified: false,
  },
  {
    id: "agents",
    label: "AGENTS.md (범용)",
    mode: "inject",
    dir: null,
    instructions: resolve("AGENTS.md"),
    detect: null,
    verified: true,
  },
];

const MARK_BEGIN = "<!-- qualisoft-ai-skills:begin -->";
const MARK_END = "<!-- qualisoft-ai-skills:end -->";

/* ── 스킬 읽기 ─────────────────────────────────────────────────── */

/** SKILL.md 프론트매터에서 name 과 description 을 뽑는다. */
function readSkill(name) {
  const file = join(SKILLS_DIR, name, "SKILL.md");
  if (!existsSync(file)) return null;
  const text = readFileSync(file, "utf8");
  const fm = /^---\n([\s\S]*?)\n---/.exec(text);
  if (!fm) return { name, description: "" };
  const get = (key) => {
    const m = new RegExp("^" + key + ": (.+)$", "m").exec(fm[1]);
    return m ? m[1].trim() : "";
  };
  return { name: get("name") || name, description: get("description") };
}

function allSkills() {
  if (!existsSync(SKILLS_DIR)) return [];
  return readdirSync(SKILLS_DIR, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => readSkill(e.name))
    .filter(Boolean)
    .sort((a, b) => a.name.localeCompare(b.name));
}

/* ── 설치 ─────────────────────────────────────────────────────── */

/* 복사로 설치한 스킬에 남기는 표식.
 *
 * 링크 설치는 realpath 비교로 소유를 알 수 있지만 복사본은 알 수 없다.
 * Windows 는 심볼릭 링크에 권한이 필요해 복사가 기본이므로, 표식이 없으면
 * uninstall 이 자기가 놓은 것조차 지우지 못한다. */
const STAMP = ".qualisoft-ai-skills.json";

function writeStamp(dest, skillName, version) {
  writeFileSync(
    join(dest, STAMP),
    JSON.stringify({ package: "@qualisoft/ai-skills", version, skill: skillName,
                     mode: "copy", installedAt: new Date().toISOString() }, null, 2) + "\n",
    "utf8",
  );
}

function readStamp(dest) {
  try {
    const j = JSON.parse(readFileSync(join(dest, STAMP), "utf8"));
    return j.package === "@qualisoft/ai-skills" ? j : null;
  } catch {
    return null;
  }
}

/**
 * 이 경로가 우리가 놓은 것인가. 남의 디렉터리를 지우지 않기 위한 확인.
 *
 * 두 설치 방식을 모두 본다 — 링크는 realpath 로, 복사는 표식 파일로.
 * 둘 중 하나라도 맞으면 우리 것이다.
 */
function isOurs(path, src) {
  try {
    if (realpathSync(path) === realpathSync(src)) return true;
  } catch {
    /* 링크가 깨졌거나 경로가 없다 — 아래에서 다시 본다 */
  }
  if (readStamp(path)) return true;
  // 죽은 링크: 대상이 사라져 realpath 가 실패한다. 가리키던 경로로 판정한다.
  // 이걸 놓치면 npx 캐시가 정리된 뒤 uninstall 이 자기 링크를 못 지운다.
  try {
    if (lstatSync(path).isSymbolicLink()) {
      const t = readlinkSync(path);
      return t.includes("@qualisoft/ai-skills") || t.startsWith(STORE) ||
             t.startsWith(SKILLS_DIR);
    }
  } catch {
    /* 판정 불가 */
  }
  return false;
}

function place(src, dest, useCopy, force, version) {
  const st = lstatSync(dest, { throwIfNoEntry: false });
  if (st) {
    const ours = isOurs(dest, src);
    if (ours && !useCopy && st.isSymbolicLink()) return "이미 연결됨";
    // 우리가 놓은 것은 힘 주지 않아도 갱신한다. 그래야 업그레이드가 된다.
    if (!ours && st.isDirectory() && !st.isSymbolicLink() && !force) {
      return "건너뜀 — 우리 표식이 없는 디렉터리입니다 (--force 로 덮어씀)";
    }
    rmSync(dest, { recursive: true, force: true });
  }
  if (!useCopy) {
    try {
      symlinkSync(src, dest, "dir");
      return "연결";
    } catch (e) {
      // Windows 외에도 권한·파일시스템 때문에 링크가 막힐 수 있다. 복사로 내려간다.
      if (!["EPERM", "EACCES", "ENOSYS", "EEXIST"].includes(e.code)) throw e;
    }
  }
  cpSync(src, dest, { recursive: true });
  writeStamp(dest, basename(dest), version);
  return useCopy ? "복사" : "복사 (링크 불가)";
}

/**
 * 도구들이 가리킬 정본 위치를 정한다.
 *
 * npx 캐시나 node_modules 에서 실행됐으면 그 경로는 사라질 수 있으므로
 * STORE 로 복사해 두고 그곳을 정본으로 쓴다. 저장소를 직접 클론해
 * 쓰는 경우(개발)에는 고친 내용이 바로 반영되도록 패키지를 그대로 쓴다.
 */
function resolveSource(skills, { direct, dryRun }) {
  if (direct || !isTransient(PKG_ROOT)) return { dir: SKILLS_DIR, staged: false };
  if (dryRun) return { dir: STORE, staged: true };
  mkdirSync(STORE, { recursive: true });
  for (const s of skills) {
    const dest = join(STORE, s.name);
    rmSync(dest, { recursive: true, force: true });
    cpSync(join(SKILLS_DIR, s.name), dest, { recursive: true });
    writeStamp(dest, s.name, VERSION);
  }
  return { dir: STORE, staged: true };
}

/** 지시문 파일의 표식 사이 블록만 갈아끼운다. 나머지 내용은 건드리지 않는다. */
function injectInstructions(file, skills, baseDir) {
  const block = [
    MARK_BEGIN,
    "",
    "## Qualisoft 프로젝트 스킬",
    "",
    "설치 위치 — `" + baseDir + "`",
    "각 스킬은 그 아래 `<스킬이름>/SKILL.md` 에 있다.",
    "",
    "요청이 아래 설명과 맞으면 **먼저 해당 `SKILL.md` 를 읽고 그 지시를 따른다.**",
    "스킬은 마크다운과 node 내장 모듈만 쓰므로 추가 설치가 필요 없다.",
    "",
    ...skills.flatMap((s) => [
      "### " + s.name,
      "",
      "`" + join(baseDir, s.name, "SKILL.md") + "`",
      "",
      s.description,
      "",
    ]),
    "**순서가 있다** — `project-interview`(기획안) → `project-init`(문서 체계)",
    "→ `project-design`(시안) → `project-build`(구현).",
    "`erd-visual` 은 독립적으로 쓴다.",
    "",
    MARK_END,
  ].join("\n");

  mkdirSync(dirname(file), { recursive: true });
  let text = existsSync(file) ? readFileSync(file, "utf8") : "";
  const begin = text.indexOf(MARK_BEGIN);
  const end = text.indexOf(MARK_END);
  if (begin !== -1 && end !== -1) {
    text = text.slice(0, begin) + block + text.slice(end + MARK_END.length);
  } else {
    text = (text.trimEnd() + "\n\n" + block + "\n").trimStart();
  }
  writeFileSync(file, text, "utf8");
}

function install(targets, { useCopy, dryRun, force, direct }) {
  const skills = allSkills();
  const skipped = [];
  if (!skills.length) {
    console.error("skills/ 가 비어 있습니다. 패키지가 손상되었습니다.");
    process.exit(1);
  }

  const source = resolveSource(skills, { direct, dryRun });
  if (source.staged) {
    console.log("정본 보관: " + source.dir + "  (npx·node_modules 는 사라질 수 있어 복사해 둡니다)");
  } else {
    console.log("정본 위치: " + source.dir + "  (수정하면 즉시 반영됩니다)");
  }

  for (const t of targets) {
    // dir 이 없는 대상은 정본을 그대로 가리킨다 — 같은 것을 두 번 두지 않는다.
    const dir = t.dir || source.dir;
    console.log("\n" + t.label + "  →  " + dir + (t.verified ? "" : "  (경로 미확인)"));
    if (dryRun) {
      skills.forEach((s) => console.log("  · " + s.name + "  (건너뜀 — dry-run)"));
      if (t.mode === "inject") console.log("  지시문: " + t.instructions);
      continue;
    }
    if (t.dir) {
      mkdirSync(dir, { recursive: true });
      for (const s of skills) {
        const how = place(join(source.dir, s.name), join(dir, s.name), useCopy, force, VERSION);
        if (how.startsWith("건너뜀")) skipped.push(join(dir, s.name));
        console.log("  · " + s.name.padEnd(20) + how);
      }
    } else {
      console.log("  · 정본을 그대로 사용합니다 (" + skills.length + "개)");
    }
    if (t.mode === "inject") {
      injectInstructions(t.instructions, skills, dir);
      console.log("  지시문: " + t.instructions);
    }
  }

  console.log("\n완료. 스킬 " + skills.length + "개.");
  if (targets.some((t) => t.mode === "native")) {
    console.log("Claude Code · Codex 는 다음 실행 때 스킬을 인식합니다.");
  }
  if (skipped.length) {
    console.log("\n건너뛴 " + skipped.length + "개 — 같은 이름의 디렉터리가 이미 있습니다:");
    skipped.forEach((p) => console.log("  " + p));
    console.log("직접 만든 스킬이면 그대로 두고, 이 패키지 것으로 바꾸려면 --force 를 붙입니다.");
    console.log("먼저 백업하세요: cp -R <경로> <경로>.bak");
  }
}

/** 지시문에서 우리 블록만 뺀다. 나머지 내용은 그대로 둔다. */
function removeInstructions(file) {
  if (!existsSync(file)) return false;
  const text = readFileSync(file, "utf8");
  const begin = text.indexOf(MARK_BEGIN);
  const end = text.indexOf(MARK_END);
  if (begin === -1 || end === -1) return false;
  const left = (text.slice(0, begin) + text.slice(end + MARK_END.length)).replace(/\n{3,}/g, "\n\n");
  writeFileSync(file, left.trim() ? left : "", "utf8");
  return true;
}

function uninstall(targets) {
  const skills = allSkills();
  for (const t of targets) {
    console.log("\n" + t.label);
    for (const s of skills) {
      const dest = join(t.dir || STORE, s.name);
      if (!lstatSync(dest, { throwIfNoEntry: false })) continue;
      // 우리가 놓은 것만 지운다. 사용자가 직접 만든 디렉터리는 남긴다.
      if (isOurs(dest, join(SKILLS_DIR, s.name))) {
        rmSync(dest, { recursive: true, force: true });
        console.log("  · " + s.name.padEnd(20) + "제거");
      } else {
        console.log("  · " + s.name.padEnd(20) + "건너뜀 — 우리 표식이 없습니다 (직접 만든 스킬이거나 1.0.0 설치본)");
      }
    }
    // 없는 스킬을 가리키는 지시문을 남기면 에이전트가 빈 경로를 읽으려 한다
    if (t.mode === "inject" && removeInstructions(t.instructions)) {
      console.log("  지시문 블록 제거: " + t.instructions);
    }
  }
  // 아무 도구도 STORE 를 안 쓰면 빈 껍데기를 남기지 않는다
  try {
    if (existsSync(STORE) && readdirSync(STORE).length === 0) {
      rmSync(STORE, { recursive: true, force: true });
      console.log("\n정본 보관 폴더 제거: " + STORE);
    }
  } catch {
    /* 지우지 못해도 문제는 아니다 */
  }
}

function status() {
  const skills = allSkills();
  console.log("패키지: " + PKG_ROOT);
  console.log("스킬 " + skills.length + "개\n");
  const w = Math.max(...skills.map((s) => s.name.length), 8);
  console.log("스킬".padEnd(w) + "  " + TARGETS.map((t) => t.id.padEnd(8)).join(""));
  for (const s of skills) {
    const cells = TARGETS.map((t) => {
      const dest = join(t.dir || STORE, s.name);
      const st = lstatSync(dest, { throwIfNoEntry: false });
      if (!st) return "-".padEnd(8);
      // link/copy = 이 패키지가 놓은 것, other = 우리 표식이 없는 내용
      if (!isOurs(dest, join(SKILLS_DIR, s.name))) return "other".padEnd(8);
      return (st.isSymbolicLink() ? "link" : "copy").padEnd(8);
    });
    console.log(s.name.padEnd(w) + "  " + cells.join(""));
  }
  console.log("\nlink = 링크 설치 · copy = 복사 설치 · other = 우리 표식이 없는 내용 · - = 없음");
  const versions = new Set();
  for (const t of TARGETS) {
    for (const s of skills) {
      const v = readStamp(join(t.dir || STORE, s.name))?.version;
      if (v) versions.add(v);
    }
  }
  if (versions.size) {
    console.log("복사 설치된 버전: " + [...versions].sort().join(", ") + "  (패키지: " + VERSION + ")");
  }
}

function list() {
  for (const s of allSkills()) {
    console.log("\n" + s.name);
    console.log("  " + s.description.replace(/(.{1,88})(\s|$)/g, "$1\n  ").trimEnd());
  }
}

/* ── 진입점 ───────────────────────────────────────────────────── */

const argv = process.argv.slice(2);
const cmd = argv.find((a) => !a.startsWith("-")) || "help";
const flag = (name) => argv.includes("--" + name);
const opt = (name) => {
  const hit = argv.find((a) => a.startsWith("--" + name + "="));
  return hit ? hit.slice(name.length + 3) : null;
};

function pickTargets() {
  const want = opt("tool");
  if (want === "all") return TARGETS;
  if (want) {
    const ids = want.split(",").map((x) => x.trim());
    const picked = TARGETS.filter((t) => ids.includes(t.id));
    const unknown = ids.filter((i) => !TARGETS.some((t) => t.id === i));
    if (unknown.length) {
      console.error("모르는 도구: " + unknown.join(", "));
      console.error("가능한 값: " + TARGETS.map((t) => t.id).join(", ") + ", all");
      process.exit(1);
    }
    return picked;
  }
  // 지정이 없으면 설정 디렉터리가 실제로 있는 도구만 고른다
  // detect 가 있는 대상만 자동 탐지한다. agents 는 명시 지정 전용이다.
  const found = TARGETS.filter((t) => t.detect && existsSync(t.detect));
  if (!found.length) {
    console.error("설치된 AI 도구를 찾지 못했습니다. --tool=<id> 로 직접 지정하세요.");
    console.error("가능한 값: " + TARGETS.map((t) => t.id).join(", ") + ", all");
    process.exit(1);
  }
  return found;
}

switch (cmd) {
  case "install":
    install(pickTargets(), {
      useCopy: flag("copy") || platform() === "win32",
      dryRun: flag("dry-run"),
      force: flag("force"),
      direct: flag("direct"),
    });
    break;
  case "uninstall":
    uninstall(pickTargets());
    break;
  case "status":
    status();
    break;
  case "list":
    list();
    break;
  default:
    console.log(`@qualisoft/ai-skills — 기획부터 구현까지의 프로젝트 스킬 5종

사용법
  npx @qualisoft/ai-skills install              설치된 도구를 찾아 전부 설치
  npx @qualisoft/ai-skills install --tool=claude,codex
  npx @qualisoft/ai-skills install --tool=all
  npx @qualisoft/ai-skills install --copy       링크 대신 복사 (Windows 기본)
  npx @qualisoft/ai-skills install --dry-run    무엇이 바뀔지만 본다
  npx @qualisoft/ai-skills install --force      기존 같은 이름 디렉터리를 덮어씀
  npx @qualisoft/ai-skills install --direct     저장소를 직접 가리킨다 (개발용)
  npx @qualisoft/ai-skills status               어디에 무엇이 설치됐는지
  npx @qualisoft/ai-skills list                 스킬 목록과 설명
  npx @qualisoft/ai-skills uninstall

도구 id
${TARGETS.map((t) => "  " + t.id.padEnd(9) + t.label + (t.verified ? "" : "  (경로 미확인)")).join("\n")}`);
}
