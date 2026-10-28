# UTM Promotion Gate — 핵심 계약 명세 (복원 원본 기반)

> 상태: reference · 최종 갱신: 2026-10-24 · 근거 원본: `docs/architecture/PROMOTION-GATE.md` (714줄 중 492줄 복원),
> `packages/provider-dsh/lib/promotion.mjs` (**367줄 전량 복원·구문검사 통과**)
> 복원 사본: `/tmp/utm-src-full/` · 상위: [UTM-COMPLIANCE.md](UTM-COMPLIANCE.md)

## 0. 복원 신뢰도 (먼저 밝힘)

| 원본 | 상태 |
|---|---|
| `promotion.mjs` | **전량 복원** (1–367줄, `node --check` 통과) |
| `PROMOTION-GATE.md` | 492/714줄. **미복원 구간**: 19-55, 131-196, 215-238, 339-415, 660-677 |
| `governance-core/src/gate.mjs`, `ledger.mjs`, `journal.mjs` | **미복원** (12바이트 stub) |

미복원 구간은 세션 로그에서 prune되어 되살릴 수 없다. 아래 §2의 G1–G6·2PC는 복원된 §1.1–1.5
원문이고, §3의 상속 규칙은 같은 세션에서 작성자가 남긴 요약으로 보강했다(원문 절 번호 병기).

---

## 1. 세션/워크스페이스는 어떻게 "승격(promotion)" 상태가 되는가

### 1.1 승격의 정의

`promotion.mjs` 헤더 주석이 정의를 명시한다:

> "A promotion here means: **register an existing directory as a DSH workspace and attach
> same-cwd sessions that are not yet accounted.** The registry owns the durable mutation;
> this module only serializes it with a lock and leaves a journal so a crash between create
> and attach is retryable on the next boot."

즉 승격 = **① 디렉터리 등록 + ② 동일 cwd의 미귀속 세션 attach**. 실제 durable mutation은
`ctx.get('workspaceRegistry')`가 소유하고, 모듈은 **lock + journal**만 책임진다.

### 1.2 3가지 모드

`applyPromotion` / `previewPromotion`은 `body.mode`로 분기한다:

| mode | 대상 | 재시작 | 세션 | 빌드 위치 |
|---|---|---|---|---|
| `existing` (기본) | 이미 존재하는 디렉터리 | 불필요 (`restartRequired: false`) | 동일 cwd 세션 attach | 즉시 |
| `scratch-cold` | 새로 만들 프로젝트 | **필요** | cold 세션만 | boot finalizer |
| `scratch-handoff` | 새로 만들 프로젝트 | 불필요 | live → 새 세션 ID handoff | 즉시 |

미지원 mode는 `UNSUPPORTED_MODE` blocker로 409.

### 1.3 Lifecycle Gate — `preview` 단계 blocker (실코드)

`apply`는 **반드시 `previewPromotion`을 먼저 호출**하고 `!preview.ok`면 레지스트리를 건드리지 않는다.

| blocker code | 조건 (promotion.mjs 실코드) |
|---|---|
| `PATH_REQUIRED` | `body.path`가 빈 문자열 |
| `PathPolicyError.code` (동적) | `canonicalDirectory()` 실패 시 **`error.code`를 그대로 blocker로 전파** — 리터럴이 아니라 `path-policy.mjs`(미복원)가 정의한다 |
| `PATH_OUTSIDE_ROOT` | `projectsRoot` 밖이고 `allowExternalPaths !== true` |
| `DEFAULT_WORKSPACE` | 대상이 `defaultWorkspaceId`의 경로와 동일 |
| `TITLE_CONFLICT` | 신규 등록인데 기존 워크스페이스와 title 대소문자 무시 중복 |
| `SESSION_ALREADY_ACCOUNTED` | 같은 cwd 세션이 **다른** 워크스페이스에 이미 귀속 |
| `UNSUPPORTED_MODE` | `existing`/`scratch-cold`/`scratch-handoff` 외 |
| `LOCK_HELD` | 승격 lock 획득 실패 (`apply`에서) |
| `REGISTRY_UNAVAILABLE` / `PERSISTENCE_UNAVAILABLE` | 서비스 부재 (throw) |

`preview` 반환값:

```js
{ ok, mode, path, canonicalPath, title, workspaceId, alreadyRegistered,
  candidateSessionIds,          // 미귀속 동일-cwd 세션, createdAt↑ 정렬
  alreadyAttachedSessionIds,    // 이미 이 워크스페이스에 붙은 세션
  blockerCodes, blockers,
  effects: { restartRequired: false, ui: 'immediate'|'none', sessionIdPreserved: true } }
```

### 1.4 `apply` — 2PC 시퀀스 (실코드 순서)

```text
1. acquirePromotionLock(txid)            // 실패 시 LOCK_HELD 409
2. previewPromotion() → !ok 이면 즉시 409 반환 (registry 무변경)
3. buildJournal(state='prepared') → writePromotionJournal()
4. registry.create(path, title)          // 이미 있으면 기존 workspace 재사용
5. journal.state='workspace-ready' → write
6. for each candidateSessionId:
     이미 attach됐으면 skip
     다른 workspace가 소유하면 throw SESSION_ALREADY_ACCOUNTED
     workspace.attachSession(id)
7. journal.state='committed', attachedSessionIds → write
8. finally: releasePromotionLock(txid)
```

**ledger와의 관계**: `promotion.mjs`는 **ledger를 직접 쓰지 않는다**. UTM 청사진 §1.2는
"ledger record commit (verification.gate 첨부)"를 apply 6단계에 두지만, 구현된 이 모듈에는
ledger 호출이 없다 — ledger writer는 `tools/governance-ledger.mjs`(미복원 stub) 소관이다.

### 1.5 Crash 복구 — `finalizePendingPromotion`

부팅 시(`apply()` 훅) journal을 읽어 재개한다:

```text
journal 없음            → { state: 'none' }
TERMINAL_STATES
  = {committed, rolledback} → 그대로 반환 (재작업 없음)
mode별 분기 → finalizeScratchCold / finalizeHandoff
state가 prepared|workspace-ready 아니면 → 그대로 반환
LOCK_HELD               → { state: 'locked' } (warn 후 skip, 다음 부팅 재시도)
그 외:
  workspaceId null/소실 → samePath로 재탐색 → 없으면 registry.create (멱등)
  → 미귀속 세션 attach → committed
  예외 → { state: 'failed' } + **journal 보존** (다음 기동 재시도)
```

핵심 불변식: **journal은 실패 시 삭제하지 않는다.** `committed`/`rolledback`만 재개 대상에서 제외.

### 1.6 노출 라우트

```js
'promotion/preview'  POST → 200
'promotion/apply'    POST → ok ? 200 : 409
'promotion/status'   POST → { ok, journal } // 현재 journal 조회
```

---

## 2. Promotion Gate 검사 항목 (G1–G6, 청사진 §1.1)

`preview`는 읽기 전용, `apply`는 **아래를 모두 통과할 때만** registry/ledger를 변경한다.

| # | 검사 | 근거 | 실패 코드 |
|---|---|---|---|
| G1 | Git baseline | `git rev-parse HEAD`, `status --porcelain`, `diff --quiet`, `diff --cached --quiet` | `GATE_GIT_DIRTY` / `GATE_NO_REPO` |
| G2 | Skeleton T1/T2 **생성** | `upm-gate skeleton --write`, T1=sha256 manifest, T2=symbol tree | `GATE_SKELETON_INVALID` |
| G3 | Skeleton **무결성** | `git ls-files` 대상만, manifest↔tree hash 비교, `node_modules`/`.env` 제외 | `GATE_SKELETON_HASH_MISMATCH` |
| G4 | 테스트 전체 통과 | `.upm/gate.json`의 `requiredGates` (UPM 기본 `npm test`, `test:provider`, `verify`) | `GATE_TEST_FAILED` |
| G5 | 경계/중립성 | core runtime-token 0, provider↔core 방향, M5 단방향 | `GATE_BOUNDARY_VIOLATION` |
| G6 | Capsule·지시 | `AGENTS.md` 존재, `promotion-capsule.json` 유효, 비밀값 스캔 | `GATE_CONTEXT_INVALID` |

결정 규칙:
- G2 **생성**과 G3 **검증**을 분리. 생성물은 `docs/skeleton/{T1.sha256,T2.tsv,meta.json}` 고정 포맷.
- **G4는 G2 이후.** 테스트가 Skeleton을 읽으므로 같은 tree를 검증해야 한다.
- G1 clean 판정은 **tracked tree** 기준. gate가 만든 `docs/skeleton`은 G2에서 commit하거나 allowlist.
- gate 자체가 preview(부작용 0) / apply(원자) 로 분리되고, 크래시는 journal로 복구.
- `restartRequired=true`면 **`pending-restart`**로 남고, `post-restart-verify` attestation 후에만 committed.

### 2.1 Gate 상태 기계 (청사진 §3.2)

```text
unverified ──gate pass──▶ verified ──commit/edit──▶ drift ──refresh──▶ verified
     │                       │
     └─ default workspace ─▶ incubation (gate 불필요)
```

| 상태 | mutation tool | 잠금 |
|---|---|---|
| `verified` | 허용 | 없음 |
| `drift` | 허용(**경고만**) | 없음 — "편집마다 잠금"은 정상 개발을 막으므로 금지 |
| `invalid` | **거부** | LOCK + repair 안내 |
| `unverified` | **거부** | LOCK (UI 우회 등록) |
| `incubation` | 허용 | INCUBATION 배너 |

---

## 3. Section/Project 관리 계약 — 사이드바가 전환을 트리거하는 방법

### 3.1 절대 불변식 (전환 시 지켜야 하는 것)

1. **레지스트리 mutation은 `ctx.workspaceRegistry` 경유** — `workspace.json` 직접 편집 금지.
2. **live 세션은 move 금지** → `handoff`(새 세션 ID, `parentSession`=source). cold만 `move` 허용.
3. **finalize 순서 detach → attach.** attach 먼저 하면 크래시 시 중복 계정으로 다음 부팅 실패.
4. **`workspace.json` 전체 복원 금지** — 대상 workspace/세션만 되돌린다.
5. **carry는 명시 경로만** — `.git`/`node_modules`/symlink/상위 탈출 금지.
6. **subagent 독립 승격 금지** — 부모 cube의 derived scope 유지.
7. **default workspace는 영구 incubation** — 승격 대상 아님(`DEFAULT_WORKSPACE`).

### 3.2 프로젝트(워크스페이스) 전환 계약

전환 요청은 **preview → 사용자 확인 → apply**의 2단계를 강제한다.

| 단계 | 호출 | 부작용 |
|---|---|---|
| 1. preflight | `promotion/preview {mode, path, title}` | **없음** (읽기 전용, blocker 전량 반환) |
| 2. 확인 UI | blocker/영향 세션 수/`restartRequired` 표시 | 없음 |
| 3. 실행 | `promotion/apply` | registry mutation |
| 4. 추적 | `promotion/status` | journal 조회 |
| 5. 재개 | 부팅 시 `finalizePendingPromotion` | crash 복구 |

- `ok:false`면 **apply를 호출하지 않는다**. blocker는 사용자에게 그대로 노출해야 한다.
- `restartRequired:true`(scratch-cold)를 받으면 UI는 재시작 안내를 띄우고, 세션 attach는
  **boot finalizer**로 미룬다(파일 준비 단계에서 workspace를 만들지 않는다).
- 전환 완료 후에도 **live 세션의 히스토리는 그대로 남는다** — 이것이 incubation 누수의 실제 원인이다.
  파일 지시가 바뀌어도 모델의 작업 기억은 바뀌지 않는다.

### 3.3 Section(세션) 전환 계약

세션 전환은 **읽기(전환)** 와 **쓰기(이동)** 를 구분한다.

| 동작 | 허용 조건 | 방법 |
|---|---|---|
| 세션 **보기/점프** (section switch) | 항상 | `uiWorkspace.openSession(id)` — 레지스트리 mutation 없음 |
| cold 세션 **이동** | `liveSessionIds()` 결과 0 | `session/move` (journal + boot finalizer) |
| live 세션 **승격** | — | **불가** → `handoff`로 새 세션 생성 |
| 세션 **삭제** | 사용자 확인 | `session/purge` |

** section jump는 절대 move를 유발하면 안 된다.** 읽기 전용 탐색이 레지스트리를 건드리면
UTM 불변식 1·2를 위반하고, crash 시 journal이 고아로 남는다.

### 3.4 실측: 현재 라이브 플러그인과 청사진의 격차

| 항목 | 청사진(`provider-dsh/promotion.mjs`) | **현재 라이브 `dsh-sidebar-manager/transaction.mjs`** |
|---|---|---|
| `promotion/*` 라우트 | 3개 | **없음** |
| 보유 라우트 | promotion 3 | session/move, purge, fork, workspace archive/restore/rename 등 **10개** |
| 승격 개념 | 명시적 `mode` 3종 | 암묵적(`fork-to-workspace`) |

→ **라이브 플러그인은 청사진의 promotion 엔진을 아직 포함하지 않는다.** §3.2의 계약을 쓰려면
`promotion.mjs`(복원본)를 플러그인 lib에 이식하고 `createPromotionRoutes`를
`createTransactionRoutes`에 병합해야 한다.

### 3.5 DSH 한계 (우회 불가)

- DSH 0.2.1-rc.2 시점 **`workspace/pre-create` waterfall이 없다.** UI가 직접 만든 워크스페이스의
  **등록 자체를 거부할 수 없다.**
- 따라서 현실적 봉쇄는 **quarantine**: gate 레코드 없는 formal workspace는 **모든 mutation tool 차단**.
- 진짜 사전 차단은 upstream 코어 훅 요청 사항(§7)이다.

---

## 4. UTM 원장이 오프라인일 때 — Graceful Degradation 가능한가?

**결론: 부분적으로 가능하다. 단 "standalone mode"는 설계에 없고, 현재 구현도 그 근거가 없다.**

### 4.1 근거 — 모듈 경계상 ledger 의존이 없다

`promotion.mjs`의 import 목록을 보면 ledger 모듈이 **전혀 없다**:

```js
import { resolveOptions } from './transaction.mjs'
import { DEFAULT_LOCK_TTL_MS, PromotionError, acquirePromotionLock, readJson,
         readPromotionJournal, releasePromotionLock, writePromotionJournal } from './promotion-store.mjs'
import { PathPolicyError, canonicalDirectory, canonicalRoot, defaultTitle,
         isUnderRoot, normalizeTitle, samePath } from './path-policy.mjs'
import { applyHandoff, finalizeHandoff, previewHandoff } from './handoff.mjs'
import { applyScratchCold, finalizeScratchCold, previewScratchCold } from './scratch-promotion.mjs'
```

- durable mutation은 **`workspaceRegistry`**, 복구는 **journal**(`~/.dsh/sidebar-manager/journal/pending.json`),
  이 둘은 DSH 소유이며 UTM과 무관하다.
- → **원장이 없어도 승격/전환의 원자성과 crash 복구는 그대로 동작한다.**

### 4.2 그러나 다음은 원장 없이 성립하지 않는다

| 기능 | 의존 | 원장 오프라인 시 |
|---|---|---|
| G1–G6 gate 판정 | `governance-core/src/gate.mjs` (미복원) | **불가** |
| gate journal hash chain `~/.dsh/governance/gates/` | `gate.mjs` wrote | **불가** |
| `ledger.verification.gate` 기록 | `tools/governance-ledger.mjs` | **불가** |
| quarantine 판정 (gate 없는 formal = 차단) | gate index | **불가** → 봉쇄 해제됨 |
| `docs/GOVERNANCE-STATUS.md` 생성 | ledger + gate journal | **불가** |
| cube 격리 / `incubation:<project>` | `cubes/index.json` | **불가** |

### 4.3 현재 이 머신의 실제 상태

실측(`~/.dsh/governance`):

```console
$ ls -d ~/.dsh/governance
ls: cannot access '/home/minami/.dsh/governance': No such file or directory
# ledger / gates / cubes 3개 디렉토리 전부 부재
```

보존된 것은 플러그인 journal 1건뿐이다(`~/.dsh/sidebar-manager/promotion/pending.json`,
`state: "committed"`, kind `promotion`, target `release-harness`).

### 4.4 판정

| 질문 | 답 |
|---|---|
| 원장 없이 승격/전환이 **동작**하는가 | **예** — registry + journal만 필요 |
| 원장 없이 **gate가 강제**되는가 | **아니오** — fail-open이 아니라 **gate 자체가 없음** |
| "graceful degradation"인가 | **아니오.** fallback 경로가 설계되지 않았고, `mode: shadow`도 gate가 있어야 의미가 있다 |
| 안전한 운영 모드 | 승격/전환 기능만 쓰고, **gate·quarantine·cube를 기대하지 않는다**. 즉 `promotion.mjs`의 `existing` 모드만 사용 |

**권고**: 청사진 §6.1대로 P1은 `sidebar-manager.governance: {mode: shadow}`로 시작한다. 단
`mode` 값을 읽는 코드가 `governance-bootstrap.mjs`(미복원)에 있으므로, **원장 복구 전에는
`mode` 설정을 추가하지 말 것** — 아무 효과 없이 "shadow 중"이라는 오해만 만든다.

---

## 5. 재현 명령

```bash
# 복원 원본 확인
node --check /tmp/utm-src-full/packages/provider-dsh/lib/promotion.mjs   # → 통과
sed -n '1,60p'  /tmp/utm-src-full/docs/architecture/PROMOTION-GATE.md    # §1.1 Gate 계약
sed -n '101,191p' /tmp/utm-src-full/packages/provider-dsh/lib/promotion.mjs  # previewPromotion

# 현재 환경: 원장 부재 확인
ls -d ~/.dsh/governance/ledger ~/.dsh/governance/gates ~/.dsh/governance/cubes 2>&1

# 라이브 플러그인에 promotion 라우트가 없는지 확인
grep -c "promotion/" /home/minami/Workspace/projects/dsh-workspace/dsh-plugins/dsh-sidebar-manager/lib/transaction.mjs
# → 0

# 보존된 journal 1건
cat ~/.dsh/sidebar-manager/promotion/pending.json
```
