---
id: {{id}}
title: {{title}}
phase: {{phase}}
status: approved
owner: TBD
summary: {{summary}}
template: log
updated: {{updated}}
---

# {{title}}

## 기록 규칙

- 결정이 **바뀌었을 때**가 아니라 **내려졌을 때** 즉시 기록한다.
- 새 의존성 추가, 스택 변경, 범위 변경은 반드시 기록한다.
- 형식: 배경 → 선택지 → 결정 → 근거 → 영향.
- 추적 ID는 `D-001` 형식으로 붙인다.

---

## {{updated}}

### D-001. 제목

| 일자 | AI | 계정 |
| --- | --- | --- |
| {{timestamp}} | {{ai}} | {{account}} |

**배경**
**선택지**
**결정**
**근거**
**영향**

---

## 템플릿

```
## YYYY-MM-DD

### D-00N. 제목

| 일자 | AI | 계정 |
| --- | --- | --- |
| YYYY-MM-DD HH:mm | Claude Code / Codex / Cursor | 계정 이름 |
**배경**
**선택지**
**결정**
**근거**
**영향**
```
