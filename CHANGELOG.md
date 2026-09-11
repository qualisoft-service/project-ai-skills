# 변경 이력

## 1.1.0 — 2026-09-11

설치 위치와 소유 판정을 고쳤습니다. **1.0.0 사용자는 전원 재설치가 필요합니다.**

```bash
npx @qualisoft/ai-skills@latest install --force
```

> 직접 고친 스킬이 있으면 `--force` 가 그 디렉터리를 지웁니다. 먼저 백업하세요.

> **`npx` 가 옛 버전을 실행하는 경우** — 과거에 `npm i -g @qualisoft/ai-skills` 로
> 전역 설치를 한 적이 있으면, `npx` 는 레지스트리에서 최신을 받지 않고 **그 전역
> 설치본을 그대로 실행합니다.** 버전을 확인하고, 낡았으면 전역 설치를 갱신하세요.
>
> ```bash
> npm ls -g --depth=0 | grep qualisoft     # 전역 설치 버전 확인
> npm i -g @qualisoft/ai-skills@latest     # 갱신
> ```
>
> 전역 설치를 쓰지 않는다면 버전을 명시하면 확실합니다 — `npx @qualisoft/ai-skills@latest install`

### 고친 것

**① npx 캐시를 직접 가리키던 문제** — 모든 플랫폼 해당

`npx @qualisoft/ai-skills install` 이 만드는 링크가 npx 캐시(`_npx/<해시>/`)를
가리켰습니다. 그 캐시는 정리 대상이라, 비워지는 순간 스킬 전체가 죽은 링크가
됩니다. README 첫 줄 명령이 이 상태를 만들고 있었습니다.

이제 임시 위치(npx 캐시 · `node_modules`)에서 실행되면 **먼저
`~/.ai-skills/qualisoft/` 로 복사하고 도구들은 그곳을 가리킵니다.** 캐시가
정리돼도 스킬은 살아 있습니다.

저장소를 클론해 개발할 때는 `--direct` 로 저장소를 직접 가리킵니다 — 고친
내용이 즉시 반영되는 기존 동작 그대로입니다.

**② 복사 설치의 소유 판정** — Windows 해당

`isOurs()` 가 `realpath` 비교뿐이라 복사본은 항상 "남의 것"으로 판정됐습니다.
Windows 는 심볼릭 링크에 관리자 권한이 필요해 복사가 기본이므로, 이 때문에

- `uninstall` 이 자기 설치본조차 지우지 못하고 (전부 "건너뜀")
- 재설치·업그레이드마다 `--force` 가 필요하고
- `--force` 는 `rmSync` 하므로 직접 수정한 내용이 날아갔습니다

복사본에 `.qualisoft-ai-skills.json` 표식을 남겨 판정합니다. 이제 Windows 도
링크 환경과 동일하게 동작합니다.

### 곁들여 고친 것

- **죽은 링크도 소유로 인정합니다.** 그러지 않으면 캐시가 정리된 뒤
  `uninstall` 이 자기 링크를 못 지웁니다. 1.0.0 설치본도 정리됩니다
- `symlink` 이 `EPERM`·`EACCES` 로 막히면 예외로 죽지 않고 **복사로
  내려갑니다**
- `cursor` 자동 탐지가 `~/.cursor/rules` 를 보고 있었습니다. 그 폴더는 없을 수
  있어 `~/.cursor` 를 봅니다
- `uninstall` 이 빈 정본 폴더를 남기지 않습니다
- `status` 가 `link` / `copy` / `other` 를 구분하고 설치된 버전을 함께
  보여줍니다

### 검증

| 시나리오 | 결과 |
| --- | --- |
| npx 캐시에서 설치 → 캐시 전체 삭제 | 스킬 동작, `selftest` 통과 |
| Windows 조건(복사 + 캐시 삭제) | 동작, `uninstall` 5개 제거 |
| 죽은 링크 정리 | 제거 |
| `--direct` (개발 모드) | 저장소 직접 링크 |
| 링크 모드 회귀 | 연결 5 / 이미 연결 5 / 제거 5 / 잔여 0 |
| 사용자가 직접 만든 스킬 | 건너뜀, 내용 보존 |
| `--dry-run` | 아무것도 쓰지 않음 |
| 실제 tarball 설치 | 정본 경유 확인 |

**보고** — Windows `uninstall` 문제는 팀 내부 검토에서 제기되었습니다. 원인
분석(`realpath` 비교 → 복사본 판정 불가)과 해결 방향(표식 기반 판정)이 정확했고,
그 실마리를 따라가 ① 을 함께 찾았습니다.

---

## 1.0.0 — 2026-09-11

최초 공개. 스킬 5종 (`project-interview` · `project-init` · `project-design` ·
`project-build` · `erd-visual`), 도구별 설치기, 외부 의존성 없음.
