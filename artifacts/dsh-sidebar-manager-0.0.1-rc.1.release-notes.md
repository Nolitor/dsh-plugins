<!-- GitHub release body for Nolitor/dsh-sidebar-manager v0.0.1-rc.1. English is the default; the Korean section follows. -->

## Read this first: the version number went **down**, on purpose

This release is `0.0.1-rc.1`. The previous release on this repository was `v0.1.3`.
**No work was undone.** The `@nolit` version ladder was reset by owner decision on 2026-11-05.

Every `@nolit` package moved to one scheme, **`0.0.1-rc.N`**, in which only the `rc#` moves.
`0.1.3` is not a milestone under that scheme — the scheme replaced it.

| Surface | Before | After |
| :--- | :--- | :--- |
| Version scheme | per-track (`0.1.0 → 0.1.1 → 0.1.2 → 0.1.3`) | **`0.0.1-rc.N`** |
| Version | `0.1.3` | **`0.0.1-rc.1`** |

---

## What changed since `v0.1.3`

### The plugin is now actually installable from npm

This is the headline, and it was a real defect: the package's `files[]` omitted
`lib/promotion-gate.mjs` and `lib/subagent-guard.mjs`, both of which `lib/transaction.mjs`
imports. Every source-tree test passed (**145/145**) while the published tarball crashed on
import with `ERR_MODULE_NOT_FOUND`.

| Check | Before | After |
| :--- | :--- | :--- |
| Tarball import of `lib/index.js` | **CRASH** `ERR_MODULE_NOT_FOUND` | loads cleanly |
| `files[]` entries | 34 (2 imported modules missing, 3 tests missing) | **39** |
| `publishConfig.access` | absent → scoped publish would go out **restricted** | **`public`** |
| Files shipped | 46 | **50** |

A new gate (`scripts/check-npm-publishable.mjs`) now packs the track, unpacks it, and proves
the import graph, the host entry, the markdown links and the market entry against the
**tarball** rather than the source tree. The old tests could not catch this class of defect;
the gate exists because they didn't.

### Generated docs index no longer ships broken links

`docs/INDEX.md` is generated and links to workspace-level files that cannot resolve inside a
tarball. It is excluded from the package via `docs/.npmignore`. It stays in the repository.

### Classifier: linked child sessions get their own label

Owner task (2026-11-05): the cleanup plan must never propose a subagent child session.
Measured live: of 22 `unregistered` logs, **20 are linked child sessions**
(`origin:"subagent"`, `parentSession:"session-…"`, `delegationDepth:1`); only **2** are true
standalone orphans. The classifier now separates them.

### Carried from v0.1.3 and earlier

Type A registration, Type B-cold provisioning, and the Type B-live handoff host cores; the
workspace group panel; the advisory soft-lint engine (schema v3 with `member.role`,
`member.policy.access`, `group.upstream`). UI shortcut and automatic skill activation (M5)
remain out of scope.

---

## Install

```bash
dsh plugin --profile web add @nolit/dsh-sidebar-manager
```

**npm:** `@nolit/dsh-sidebar-manager@0.0.1-rc.1` · dist-tags `rc` and `latest`
**Verify:** `npm test` → 145/145 passing

## Assets

No binary asset. The package is distributed through npm.

---

## 한국어

## 먼저 읽어주세요: 버전 숫자가 **내려간** 이유

이 릴리스는 `0.0.1-rc.1`입니다. 직전 릴리스는 `v0.1.3`이었습니다.
**작업이 되돌려진 것이 아닙니다.** 2026-11-05 소유자 결정으로 `@nolit` 버전 사다리가
재설정됐습니다.

모든 `@nolit` 패키지가 **`0.0.1-rc.N`** 한 체계로 통일됐고, **`rc#`만 올라갑니다.**
`0.1.3`은 새 체계에서 마일스톤이 아니며, 새 체계가 이를 대체했습니다.

| 표면 | 이전 | 이후 |
| :--- | :--- | :--- |
| 버전 체계 | 트랙마다 제각각 (`0.1.0 → 0.1.1 → 0.1.2 → 0.1.3`) | **`0.0.1-rc.N`** |
| 버전 | `0.1.3` | **`0.0.1-rc.1`** |

## `v0.1.3` 이후 달라진 것

### 이제 npm에서 실제로 설치됩니다

이번 릴리스의 핵심이며, 실제 결함이었습니다. 패키지의 `files[]`에 `lib/promotion-gate.mjs`와
`lib/subagent-guard.mjs`가 빠져 있었는데, 둘 다 `lib/transaction.mjs`가 import합니다.
소스트리 테스트는 **145/145 전부 통과**했지만, 배포된 tarball은 import 시점에
`ERR_MODULE_NOT_FOUND`로 죽었습니다.

| 검사 | 이전 | 이후 |
| :--- | :--- | :--- |
| tarball에서 `lib/index.js` import | **CRASH** `ERR_MODULE_NOT_FOUND` | 정상 로드 |
| `files[]` 항목 | 34 (import 대상 2개, 테스트 3개 누락) | **39** |
| `publishConfig.access` | 없음 → scoped 배포가 **restricted**로 나감 | **`public`** |
| 배포 파일 수 | 46 | **50** |

새 게이트(`scripts/check-npm-publishable.mjs`)가 트랙을 실제로 pack·해제하여 import 그래프,
호스트 진입점, 마크다운 링크, market 항목을 **소스트리가 아니라 tarball 기준**으로
검증합니다. 기존 테스트가 잡지 못한 종류의 결함이라 게이트를 새로 만들었습니다.

### 생성 문서 인덱스의 깨진 링크 제거

`docs/INDEX.md`는 생성 파일이며 tarball 안에서 해석될 수 없는 워크스페이스 경로를 링크합니다.
`docs/.npmignore`로 패키지에서 제외했습니다. 저장소에는 그대로 남습니다.

### 분류기: 연결된 자식 세션은 별도 레이블

소유자 지시(2026-11-05): 정리 계획이 서브에이전트 자식 세션을 제안해서는 안 됩니다.
실측: `unregistered` 로그 22개 중 **20개가 연결된 자식 세션**(`origin:"subagent"`,
`parentSession:"session-…"`, `delegationDepth:1`)이고, 진짜 고아는 **2개**뿐입니다.
분류기가 이제 둘을 구분합니다.

### v0.1.3 이전부터 이어지는 것

Type A 등록, Type B-cold 프로비저닝, Type B-live 핸드오프 호스트 코어; 워크스페이스 그룹 패널;
advisory 소프트 린트 엔진(schema v3, `member.role`, `member.policy.access`, `group.upstream`).
UI 단축키와 자동 스킬 활성화(M5)는 범위 밖입니다.

## 설치

```bash
dsh plugin --profile web add @nolit/dsh-sidebar-manager
```

**npm:** `@nolit/dsh-sidebar-manager@0.0.1-rc.1` · dist-tag `rc`, `latest`
**검증:** `npm test` → 145/145 통과

## 자산

바이너리 자산 없음. 패키지는 npm으로 배포됩니다.
