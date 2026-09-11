#!/usr/bin/env node
import { readFileSync } from "node:fs";

const [briefPath, decisionsPath, questionsPath] = process.argv.slice(2);
if (!briefPath || !decisionsPath || !questionsPath) {
  console.error("사용법: node validate.mjs <기획안> <결정기록> <미결기록>");
  process.exit(1);
}

const read = (path) => readFileSync(path, "utf8");
const brief = read(briefPath);
const decisions = read(decisionsPath);
const questions = read(questionsPath);
const optionIds = [
  "seo", "naver", "geo", "analytics", "tagmanager", "adtracking", "consent",
  "a11y", "perfbudget", "i18n", "cms", "contactform", "darkmode",
];
const errors = [];

const profileAxes = {
  scale: ["solo", "small", "standard", "large"],
  risk: ["low", "standard", "regulated"],
  delivery: ["prototype", "mvp", "production"],
};
for (const [axis, levels] of Object.entries(profileAxes)) {
  if (!new RegExp(`^  ${axis}: (${levels.join("|")})$`, "m").test(brief)) {
    errors.push(`profile.${axis} 누락 또는 값 오류 (${levels.join(" | ")})`);
  }
}
for (const id of optionIds) {
  if (!new RegExp(`^  ${id}: (true|false|unknown)$`, "m").test(brief)) {
    errors.push(`option_hints 누락 또는 값 오류: ${id}`);
  }
}
for (const title of ["최종 목표 범위", "첫 출시 범위", "이번에 하지 않는 것",
                     "산출물 범위", "만들지 않기로 한 것"]) {
  if (!brief.includes(title)) errors.push(`기획안 필수 항목 누락: ${title}`);
}
const meta = /\| `\d{4}-\d{2}-\d{2} \d{2}:\d{2}` \| `[^`]+` \| `[^`]+` \|/;
if (/DI-\d+/.test(decisions) && !meta.test(decisions)) errors.push("DI 작성자 속성 표 누락");
if (/OQ-\d+/.test(questions) && !/\d{4}-\d{2}-\d{2} \d{2}:\d{2}/.test(questions)) {
  errors.push("OQ 일자(분 단위) 누락");
}

if (errors.length) {
  for (const error of errors) console.error("- " + error);
  process.exit(1);
}
console.log("project-interview 전달 계약 검증 통과");
