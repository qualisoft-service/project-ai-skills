# @qualisoft/ai-skills

**기획 인터뷰 → 문서 체계 → 디자인 시안 → 구현.** 프로젝트 한 건을 끝까지 끌고 가는 AI 에이전트 스킬 5종입니다.

Claude Code · Codex · Gemini CLI · Cursor 어디서든 같은 스킬을 씁니다. **외부 의존성이 없습니다** — 마크다운과 Node 내장 모듈만 사용합니다.

```bash
npx @qualisoft/ai-skills install
```

설치된 AI 도구를 찾아 스킬을 연결합니다. 그 다음 에이전트에게 평소처럼 말하면 됩니다.

> "이런 서비스를 만들고 싶은데 기획안부터 정리해줘"

---

## 무엇이 들어 있나

스킬은 **순서대로 물립니다.** 앞 단계의 산출물이 뒤 단계의 입력이 됩니다.

| | 스킬 | 하는 일 | 산출물 |
| :---: | --- | --- | --- |
| 1 | **`project-interview`** | 아이디어만 있는 상태에서 **선택형 인터뷰**로 기획안을 만든다 | `Docs/_intake/*.md` 기획안, 결정·미결 기록 |
| 2 | **`project-init`** | 기획안을 흡수해 **산출물 정의서 · 요구사항 · WBS** 세 축을 세우고 공정별 정의서를 만든다. 검증기가 표준을 강제한다 | `Docs/*.md` + 단일 `index.html` |
| 3 | **`project-design`** | 설계도를 근거로 디자인 규칙과 시안을 만든다. 웹 · 앱 · 어드민 · PPT · 인쇄물 | `Docs/_design/` 토큰 · 시안 · 스타일 가이드 |
| 4 | **`project-build`** | 시안을 실제 코드로 옮긴다. **시안 ↔ 구현 대조기**로 어긋남을 판정한다 | `src/`, `Docs/_build/parity.html` |
| — | **`erd-visual`** | Excel · CSV · DDL · XML · Prisma · JSON Schema를 읽어 **시각 ERD**를 만든다. 독립적으로 쓴다 | 서버 없이 열리는 ERD HTML |

`erd-visual`만 독립이고, 1→4는 이어서 씁니다. 물론 2번만 써도 됩니다.

---

## 설치

### 한 번에

```bash
npx @qualisoft/ai-skills install
```

`~/.claude`, `~/.codex` 같은 설정 디렉터리가 **실제로 있는 도구만** 골라 설치합니다.

### 도구를 지정해서

```bash
npx @qualisoft/ai-skills install --tool=claude,codex
npx @qualisoft/ai-skills install --tool=all
```

| id | 도구 | 설치 방식 |
| --- | --- | --- |
| `claude` | Claude Code | `~/.claude/skills/` — 네이티브 |
| `codex` | Codex CLI | `~/.codex/skills/` — 네이티브 |
| `gemini` | Gemini CLI | 공용 위치 + `~/.gemini/GEMINI.md` 에 목록 주입 |
| `cursor` | Cursor | 공용 위치 + `~/.cursor/rules/` 에 목록 주입 |
| `agents` | 범용 | 공용 위치 + 현재 폴더 `AGENTS.md` 에 목록 주입 |

### 그 밖의 명령

```bash
npx @qualisoft/ai-skills status      # 어디에 무엇이 설치됐는지
npx @qualisoft/ai-skills list        # 스킬 설명 전문
npx @qualisoft/ai-skills install --dry-run   # 바뀔 것만 미리 본다
npx @qualisoft/ai-skills install --copy      # 링크 대신 복사 (Windows 기본)
npx @qualisoft/ai-skills install --force     # 같은 이름 디렉터리를 덮어쓴다
npx @qualisoft/ai-skills uninstall
```

**같은 이름의 스킬이 이미 있으면 건너뜁니다.** 직접 고쳐 쓰던 스킬을 지우지 않기 위해서입니다. 바꿀 생각이면 백업하고 `--force`를 붙이세요.

---

## 어떻게 세 도구에서 다 되나

스킬의 실체는 **마크다운 지시문 + Node 스크립트**입니다. 도구마다 다른 것은 실행 방식이 아니라 **스킬을 발견하는 방식**뿐입니다. 그래서 설치기가 하는 일도 그 하나입니다.

```
Claude Code · Codex          스킬 디렉터리를 직접 읽는다  →  심볼릭 링크만 걸면 끝
                             ~/.claude/skills/<이름>/SKILL.md

Gemini · Cursor · 그 외       스킬 개념이 없다  →  공용 위치에 두고
                             ~/.ai-skills/qualisoft/     지시문 파일에 목록을 적는다
                             + GEMINI.md / AGENTS.md
```

주입되는 블록은 표식으로 감싸여 있어(`<!-- qualisoft-ai-skills:begin -->`) **기존 지시문을 건드리지 않고** 그 부분만 갈아끼웁니다. `uninstall`은 블록만 빼고 나머지는 남깁니다.

> **경로 정확도** — `claude` · `codex` · `agents`는 실제로 확인한 경로입니다. `gemini` · `cursor`는 각 도구 문서를 근거로 넣었고 버전에 따라 다를 수 있습니다. 어긋나면 `bin/cli.mjs` 상단 `TARGETS` 한 곳만 고치면 됩니다.

---

## 무엇이 다른가

### 1. 검증기가 표준을 강제한다

`project-init`은 문서를 만들고 나서 검사합니다. **검사에 실패하면 `index.html`을 만들지 않습니다.**

```
✗ 04-project-brief.md
    필수 섹션 누락: 한 줄로 말하면
1건 실패 — 빌드 중단
```

프론트매터 누락, 깨진 `[[링크]]`, 정의되지 않은 추적 ID, 문서 종류별 필수 섹션 — 지침이 아니라 규칙입니다. 지침은 지켜지지 않습니다.

### 2. 산출물이 없는 과업은 WBS에 올리지 않는다

세 축이 서로를 가리킵니다.

```
요구사항 (R-01) ──연계 과업──▶ WBS 과업 (W-01)
      │                            │
      └──────연계 산출물──────▶ 산출물 (DLV-01)
```

과업을 만들 때 "이걸 하면 무엇이 남는가"를 먼저 묻습니다. 안 남으면 과업이 아닙니다. **이 규칙 하나가 과업 폭증을 막습니다** — 과업 수는 산출물 수를 넘을 수 없습니다.

공정은 **상시 + 5단계**입니다. 대형 SI의 9공정이 여기로 접힙니다.

```
00. 관제탑 · 01. 상시 · 사업관리
10. 착수·분석 → 20. 설계 → 30. 구축 → 40. 검증 → 50. 오픈·안정화
```

### 3. 프로젝트 크기만큼만 문서가 나온다

세 축(`scale` · `risk` · `delivery`)으로 문서 개수가 정해집니다. 2주짜리 랜딩과 7개월짜리 시스템이 같은 문서 세트를 받지 않습니다.

```
solo   9개      혼자, 몇 주
small  15개     1~2명, 1~2개월
large  19~21개  다인원, 6개월 이상
```

### 4. 고객이 읽을 수 있게 쓴다 (ELI5)

모든 정의서는 `## 한 줄로 말하면` 으로 시작합니다. 없으면 빌드가 막힙니다.

```markdown
## 한 줄로 말하면

> 계약 내용이 바뀌면 담당자 팀즈로 자동 메시지가 갑니다.

**왜 필요한가** — 지금은 직접 들어가 봐야 변경을 압니다.
모르고 지나가면 잘못된 조건으로 영업이 나갑니다.

**비유하자면** — 택배 배송 알림과 같습니다.
```

### 5. 상용 라이브러리를 쓰지 않는다

`npm ls`가 비어 있습니다. `fs` · `path` · `url` · `zlib` 만 씁니다. 설치 시간도, 취약점 알림도, 라이선스 검토도 없습니다.

---

## 쓰는 법

설치 후에는 평소처럼 말하면 됩니다. 각 스킬의 `description`에 트리거 문구가 들어 있어 에이전트가 알아서 고릅니다.

| 이렇게 말하면 | 이 스킬이 붙는다 |
| --- | --- |
| "아이디어가 있는데 정리해줘", "기획안 만들어줘" | `project-interview` |
| "PRD 작성", "산출물 정의서", "WBS 정리", "Docs 빌드" | `project-init` |
| "디자인 시안 뽑아줘", "이 레퍼런스처럼", "PPT 만들어줘" | `project-design` |
| "구현 시작", "시안대로 만들어줘", "스캐폴딩" | `project-build` |
| "ERD 그려줘", "이 엑셀로 DB 구조 시각화" | `erd-visual` |

Claude Code · Codex 에서는 `/project-init` 처럼 직접 호출할 수도 있습니다.

### 전체 흐름 예시

```bash
# 1. 아이디어만 있는 상태
"사내 계약관리 시스템을 만들려는데 기획안부터 정리해줘"
  → Docs/_intake/2026-09-11-contract-system.md

# 2. 문서 체계
"이 기획안 흡수해서 문서 만들어줘"
  → Docs/*.md + index.html  (산출물 정의서 · 요구사항 · WBS 포함)

# 3. 시안
"어드민 화면 시안 만들어줘. Linear 같은 톤으로"
  → Docs/_design/  토큰 · 시안 · 스타일 가이드

# 4. 구현
"시안대로 구현 시작해줘"
  → src/ + Docs/_build/parity.html  (시안 ↔ 구현 대조)
```

`Docs/index.html`을 브라우저로 열면 1~4단계 진행률이 한 화면에 나옵니다.

---

## 직접 고쳐 쓰기

설치는 **심볼릭 링크**입니다. 저장소의 `skills/`를 고치면 모든 도구에 즉시 반영됩니다.

```bash
git clone https://github.com/qualisoft-service/project-ai-skills
cd project-ai-skills
node bin/cli.mjs install --tool=all --force

# skills/project-init/modules/*.json 을 고치면 곧바로 적용된다
node skills/project-init/build.mjs selftest
```

`project-init`의 확장 지점은 셋입니다.

| 무엇을 바꾸나 | 어디를 고치나 |
| --- | --- |
| 문서 묶음 추가·병합 | `skills/project-init/modules/*.json` |
| 자주 쓰는 조합 고정 | `skills/project-init/presets/*.json` |
| 검증 규칙 (필수 섹션 등) | `skills/project-init/schema.json` |

**프리셋을 먼저 만들지 마세요.** 모듈 조합으로 되는지 본 다음, 자주 쓰는 조합만 프리셋으로 굳힙니다.

---

## 요구 사항

- **Node.js 18 이상** (`node -v`로 확인)
- macOS · Linux · Windows. Windows는 링크 대신 복사로 자동 전환됩니다

## 저장소 · 문의

- 소스 — <https://github.com/qualisoft-service/project-ai-skills>
- 버그·제안 — <https://github.com/qualisoft-service/project-ai-skills/issues>

경로가 맞지 않는 도구를 발견하면 이슈로 알려주세요. `bin/cli.mjs` 의 `TARGETS`
한 곳만 고치면 됩니다.

## 라이선스

MIT
