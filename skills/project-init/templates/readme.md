---
id: {{id}}
title: {{title}}
phase: {{phase}}
status: approved
owner: TBD
summary: {{summary}}
template: readme
updated: {{updated}}
---

# {{title}}

이 폴더는 **구현 이전에 정립되어야 하는 모든 정의**를 담는다.
코드가 아니라 합의를 저장하는 곳이다.

## 원칙

1. **하나의 문서 = 하나의 의사결정 영역.** 같은 내용을 두 문서에 쓰지 않는다.
2. **모르는 것은 비워두고 표시한다.** 추측으로 채우지 않는다. 미정은 `TODO(주체)` 또는 리스크 대장으로 보낸다.
3. **문서는 코드보다 먼저, 그러나 코드보다 짧게.** 읽히지 않는 문서는 없는 문서다.
4. **결정이 바뀌면 문서를 고치고 의사결정 기록에 남긴다.**

## 상태 값

| status | 뜻 |
| --- | --- |
| `draft` | 초안. 내용이 비어 있거나 검증되지 않음 |
| `review` | 검토 요청 상태 |
| `approved` | 합의 완료. 변경 시 의사결정 기록 필요 |

## 문서 종류

| template | 필수 섹션 | 성격 |
| --- | --- | --- |
| `spec` | 미결정, 변경 이력 | 정의서 |
| `register` | 변경 이력 | 대장 — 열린 항목 목록 |
| `log` | 없음 | 기록 — 확정 항목 누적 |
| `reference` | 변경 이력 | 참조표 |
| `readme` | 없음 | 이 문서 |

## 읽는 방법

- **사람**: `index.html`을 브라우저로 연다.
- **에이전트**: 개별 `.md`를 읽는다. 프론트매터 `summary`로 필요한 문서만 고른다.

## 표기 규칙

| 표기 | 뜻 |
| --- | --- |
| `[[문서-id]]` | 문서 간 링크. 깨지면 빌드가 실패한다 |
| `TODO(client)` | 정보 제공 대기. `design` `copy` `legal` 등으로 주체를 밝힌다 |
| `B-01` `F-01` `D-001` | 추적 ID. `PREFIX-번호` 형식만 매트릭스에 잡힌다 |

## 검증과 빌드

```bash
node ~/.claude/skills/project-init/build.mjs check
node ~/.claude/skills/project-init/build.mjs build
```

검증에 실패하면 빌드되지 않는다. 이것이 표준이 유지되는 유일한 이유다.
