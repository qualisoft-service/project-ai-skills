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
  lstatSync, rmSync, symlinkSync, cpSync, realpathSync,
} from "node:fs";
import { homedir, platform } from "node:os";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const PKG_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const SKILLS_DIR = join(PKG_ROOT, "skills");
const HOME = homedir();

/* ── 설치 대상 ──────────────────────────────────────────────────────
 * mode: "native" — 도구가 스킬 디렉터리를 직접 읽는다. 링크만 걸면 끝.
 * mode: "inject" — 스킬 개념이 없는 도구. 공용 위치에 두고 지시문에 목록을 적는다.
 *
 * 경로가 바뀌면 여기만 고친다. verified 는 실제로 확인한 경로인지를 뜻한다. */
const TARGETS = [
  {
    id: "claude",
    label: "Claude Code",
    mode: "native",
    dir: join(HOME, ".claude", "skills"),
    verified: true,
  },
  {
    id: "codex",
    label: "Codex CLI",
    mode: "native",
    dir: join(HOME, ".codex", "skills"),
    verified: true,
  },
  {
    id: "gemini",
    label: "Gemini CLI",
    mode: "inject",
    dir: join(HOME, ".ai-skills", "qualisoft"),
    instructions: join(HOME, ".gemini", "GEMINI.md"),
    verified: false,
  },
  {
    id: "cursor",
    label: "Cursor",
    mode: "inject",
    dir: join(HOME, ".ai-skills", "qualisoft"),
    instructions: join(HOME, ".cursor", "rules", "qualisoft-ai-skills.mdc"),
    verified: false,
  },
  {
    id: "agents",
    label: "AGENTS.md (범용)",
    mode: "inject",
    dir: join(HOME, ".ai-skills", "qualisoft"),
    instructions: resolve("AGENTS.md"),
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

/** 이미 우리 스킬을 가리키는 링크인가. 남의 디렉터리를 지우지 않기 위한 확인. */
function isOurs(path, src) {
  try {
    return realpathSync(path) === realpathSync(src);
  } catch {
    return false;
  }
}

function place(src, dest, useCopy, force) {
  const st = lstatSync(dest, { throwIfNoEntry: false });
  if (st) {
    if (!useCopy && isOurs(dest, src)) return "이미 연결됨";
    // 남이 놓은 실디렉터리는 지우지 않는다. 사용자의 수정이 들어 있을 수 있다.
    if (st.isDirectory() && !st.isSymbolicLink() && !force) {
      return "건너뜀 — 기존 디렉터리가 있습니다 (--force 로 덮어씀)";
    }
    rmSync(dest, { recursive: true, force: true });
  }
  if (useCopy) {
    cpSync(src, dest, { recursive: true });
    return "복사";
  }
  symlinkSync(src, dest, "dir");
  return "연결";
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

function install(targets, { useCopy, dryRun, force }) {
  const skills = allSkills();
  const skipped = [];
  if (!skills.length) {
    console.error("skills/ 가 비어 있습니다. 패키지가 손상되었습니다.");
    process.exit(1);
  }

  for (const t of targets) {
    console.log("\n" + t.label + "  →  " + t.dir + (t.verified ? "" : "  (경로 미확인)"));
    if (dryRun) {
      skills.forEach((s) => console.log("  · " + s.name + "  (건너뜀 — dry-run)"));
      continue;
    }
    mkdirSync(t.dir, { recursive: true });
    for (const s of skills) {
      const how = place(join(SKILLS_DIR, s.name), join(t.dir, s.name), useCopy, force);
      if (how.startsWith("건너뜀")) skipped.push(join(t.dir, s.name));
      console.log("  · " + s.name.padEnd(20) + how);
    }
    if (t.mode === "inject") {
      injectInstructions(t.instructions, skills, t.dir);
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
      const dest = join(t.dir, s.name);
      if (!lstatSync(dest, { throwIfNoEntry: false })) continue;
      // 우리가 놓은 것만 지운다. 사용자가 직접 만든 디렉터리는 남긴다.
      if (isOurs(dest, join(SKILLS_DIR, s.name))) {
        rmSync(dest, { recursive: true, force: true });
        console.log("  · " + s.name.padEnd(20) + "제거");
      } else {
        console.log("  · " + s.name.padEnd(20) + "건너뜀 — 이 패키지가 놓은 것이 아닙니다");
      }
    }
    // 없는 스킬을 가리키는 지시문을 남기면 에이전트가 빈 경로를 읽으려 한다
    if (t.mode === "inject" && removeInstructions(t.instructions)) {
      console.log("  지시문 블록 제거: " + t.instructions);
    }
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
      const dest = join(t.dir, s.name);
      if (!lstatSync(dest, { throwIfNoEntry: false })) return "-".padEnd(8);
      // link = 이 패키지가 놓은 것, other = 다른 내용이 이미 있음
      return (isOurs(dest, join(SKILLS_DIR, s.name)) ? "link" : "other").padEnd(8);
    });
    console.log(s.name.padEnd(w) + "  " + cells.join(""));
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
  const found = TARGETS.filter((t) =>
    t.mode === "native"
      ? existsSync(dirname(t.dir))
      : t.id !== "agents" && existsSync(dirname(t.instructions)),
  );
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
  npx @qualisoft/ai-skills status               어디에 무엇이 설치됐는지
  npx @qualisoft/ai-skills list                 스킬 목록과 설명
  npx @qualisoft/ai-skills uninstall

도구 id
${TARGETS.map((t) => "  " + t.id.padEnd(9) + t.label + (t.verified ? "" : "  (경로 미확인)")).join("\n")}`);
}
