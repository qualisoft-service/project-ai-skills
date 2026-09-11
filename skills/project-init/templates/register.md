---
id: {{id}}
title: {{title}}
phase: {{phase}}
status: draft
owner: TBD
summary: {{summary}}
template: register
updated: {{updated}}
---

# {{title}}

## 한 줄로 말하면

> TODO(owner) — 이 문서가 하는 일을 한 문장으로. 전문용어 없이, 60자 이내.

**왜 필요한가** — 이게 없으면 무엇이 문제인가. 두 문장 이내.

**비유하자면** — 익숙한 것에 견준다. 한 문장.

**이 문서를 읽어야 하는 사람** — 역할 이름으로 적는다.

## 등급

| 등급 | 뜻 |
| --- | --- |
| `Blocker` | 해소 전 다음 단계 진입 불가 |
| `High` | 늦어질수록 재작업 비용이 큼 |
| `Medium` | 진행하며 병행 결정 가능 |

## 항목

> 추적 ID는 `PREFIX-번호` 형식으로 붙인다 (`B-01`, `H-01`, `M-01`).
> 이 형식만 문서 간 추적 매트릭스에 잡힌다.

아직 등록된 항목이 없다. 아래 형식을 복사해 추가한다.

```
### B-01. 항목 제목

| | |
| --- | --- |
| **일자** | YYYY-MM-DD HH:mm |
| **AI** | Claude Code / Codex / Cursor |
| **계정** | 계정 이름 |
| **차단 단계** | design / implementation / release |
| **문제** | |
| **영향** | |
| **필요 결정** | |
| **결정 주체** | |
| **상태** | 미해소 |
```

## 변경 이력

### {{updated}}

| 일자 | AI | 계정 |
| --- | --- | --- |
| {{timestamp}} | {{ai}} | {{account}} |

- 최초 작성
