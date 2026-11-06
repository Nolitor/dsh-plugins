# UTM 거버넌스 리뷰 — Forge/Worktrees vs Sidebar Manager
<!-- skeleton:
version: 1.0
kind: report
status: reference
updated: 2026-10-29
summary: Read-only review of the Forge/Worktrees vs Sidebar/UTM measurement against UTM authority docs.
-->


> 검토 대상: `FORGE-VS-SIDEBAR-UTM-MEASUREMENT.md` (2026-10-29, 119행)
> 검토 방식: read-only. UTM 권위 문서 4종과 report/evidence를 교차 확인.
> 판정: **APPROVE WITH CHANGES**

## 0. 한 줄 결론

기능 영역 중첩과 정책 우회 가능성이라는 방향은 맞다. 그러나 report는 **코드/README 기반 추론을 "실측"으로 표기**했고,
`read-only`/`self-contained` 정책 우회를 실제로 재현하지 않았다. 또한 P0 권고인 "Worktree 옵션 비활성화"는
UTM의 비차단·advisory 원칙과 정면으로 충돌한다. **보고서 수정 후 승인**이 맞다.

## 1. 중첩/리스크 특성화는 맞는가

맞는 부분:
- Forge bundle이 `dsh-experimental-forge-bundle`로 부팅되고 `forge`, `forge-github`, `forge-session`,
  `forge-worktree`, `forge-panel` row가 구성된다는 점은 `dump-forge.yml`과 일치한다.
- Forge Worktree가 Session cwd를 바꾸고, workspace registry(`workspace.json`)를 갱신하지 않는다는
  방향의 지적은 타당하다. `dsh-experimental-worktree` 코드도 `ctx.workingDirectory.set`을 호출하고
  `sandboxPolicy.resolve`만 사용한다.
- Sidebar Manager의 `policy.access`가 advisory이고, `groups/mutation-check`가 soft rejection만 반환한다는
  지적도 `contract-advisory.mjs` 및 `transaction.mjs`와 일치한다.
- 직접적인 UI slot 충돌이 확인되지 않았다는 결론도 현재 증거 범위에서는 수용 가능하다.

수정이 필요한 부분:
1. **"정책 우회"의 의미가 과장됐다.** `UTM-ARCHITECTURE-SPEC.md` §3.4는
   "mutation from INSIDE the target workspace → always allowed"다. Forge가 현재 workspace 안에서
   worktree를 만드는 것은 UTM 정책 의미상 "외부 workspace의 mutation"이 아니다.
   실제 문제는 **Forge가 policy resolution 자체를 호출하지 않아 cross-context 여부를 판별하지 못하고,
   `groups/mutation-check`도 Forge/Workspace Manager의 write 경로에 연결되어 있지 않다**는 점이다.
2. **"실측" 표의 두 항목은 실측이 아니다.** report §2의
   `Worktree 생성 경로 <repo>/.agents/worktrees/...`와 `cwd 변경 ctx.workingDirectory.set`은
   `forge-ui.json`/screenshot에서 확인되지 않는다. 증거는 "From main" selector 표시까지이며,
   `.runtime-measure/forge-fixture/.agents/worktrees`도 존재하지 않는다. 해당 항목은
   package README/source에서 얻은 **inferred/source-derived**로 분리해야 한다.
3. **정책 우회를 read-only 멤버에서 재현하지 않았다.** `groups.json` 스냅샷의 Core-00-System,
   Core-01-UTM, Core-02-HUB는 `read-only`, Core-99-UROH는 `self-contained`인데,
   실제 실험은 그룹 미가입 `Forge Fixture`에서만 수행됐다.
4. **stale fingerprint, prune/rollback, registry 비인지의 결과는 가설이다.** worktree를 실제 생성한 뒤의
   session log, `workspace.json`, `git worktree list --porcelain`, 그룹 fingerprint를 before→after로
   측정한 증거가 없다.
5. **`gh` readiness와 UI slot 목록**은 문서/소스 기반 서술에 가깝다. "미설치"는 실측이지만,
   provider readiness 동작은 runtime 검증이 아니다.

## 2. 근거가 부족하거나 과소 명세된 claim

| report 위치 | claim | 문제 |
|---|---|---|
| §2 | Worktree 생성 경로 | 실제 생성 산출물 없음. source/README 추론임 |
| §2 | `ctx.workingDirectory.set`으로 cwd 변경 | 클릭만 했고 session cwd 변경 전/후 기록 없음 |
| §3.2 | read-only 그룹에서도 Worktree 생성 가능 | read-only 멤버에서 생성 시도/재현 없음 |
| §3.2 | Sidebar fingerprint stale | 실제 worktree 진입 후 멤버십/fingerprint 비교 없음 |
| §3.2 | prune/rollback 경계 | rollback/prune 시나리오 실행 없음 |
| §3 표 | UI slot 목록 | 어떤 manifest/evidence에서 추출했는지 미기재 |
| §0/§2 | GitHub polling 비활성 | `gh` 미설치와 provider readiness를 혼합. full runtime 검증 아님 |

## 3. 위반되었거나 위험에 노출된 UTM 규칙 (정확한 참조)

- **`UTM-ARCHITECTURE-SPEC.md` §3.4 Policy resolution / §4.2 Soft lint**
  Forge가 `groups/mutation-check` 또는 동등한 policy resolution을 호출하지 않는다.
  따라서 cross-context mutation에 대해 `POLICY_READ_ONLY`/`POLICY_SELF_CONTAINED` observation이
  surface될 기회가 없다. UTM의 "advisory soft rejection with context"가 우회될 위험이 실제로 존재한다.
- **`UTM-ARCHITECTURE-SPEC.md` §4.1 What is rejected / §4.4 Core invariant**
  "Tool quarantine / mutation-tool disabling", "hard write-blocks", "No observation, policy, or gate result
  may prevent a workspace from being edited..."와 충돌한다. report P0의 "Worktree 옵션 비활성화"는
  UTM 정책으로 정당화할 수 없다. 경고/관찰/soft rejection만 가능하다.
- **`UTM-ARCHITECTURE-SPEC.md` §5.4 Live sessions are never moved**
  Forge의 동일 Session `workingDirectory.set`은 handoff(`new id`, `parentSession`) 없이 live session의
  작업 위치를 바꾼다. UTM-managed session에 적용할 경우 구조 불변식과 충돌한다.
- **`UTM-ARCHITECTURE-SPEC.md` §5.7 Contracts carry no runtime / §2.1**
  contract node 아래 `.agents/worktrees`가 생성되면 runtime checkout이 contract workspace 내부에 남는다.
  `contract-advisory.mjs`의 `IMPLEMENTATION_ARTIFACTS`는 top-level 이름만 보고 `.agents`를 포함하지 않아
  현재 advisory로도 감지되지 않는다.
- **`UTM-ARCHITECTURE-SPEC.md` §5.2 Grouping is metadata / `RULES.md` R-M2 Path identity cross-check**
  Forge worktree가 `workspace.json`에 등록되지 않으면 group metadata로 정책을 매핑할 수 없다.
  report는 read-only/self-contained 대상 경로와 worktree 경로의 identity를 1:1로 제시하지 않았다.
- **`RULES.md` R-M1 (Measure before acting), R-M4 (Completion measurement)**
  추론을 측정으로 표기했고, worktree 생성 전/후 count 및 registry/session 일관성 검증이 없다.
- **`UTM-GOVERNANCE-RULES.md` A-5 / P-1 / P-2, `RULES.md` §5 Authority Boundary**
  report 자체는 advisory 문서이므로 허용 범위다. 그러나 P0를 실제 "옵션 비활성화" 구현으로 옮기려면
  Core-01-UTM이 아니라 구현 주체가 Master의 **explicit, scoped exemption** 아래 수행해야 한다.
  이 보고서를 developer work order로 해석하면 P-1/P-2 경계를 침범한다.

## 4. Forge Worktree 허용 전 필요한 구체적 guardrail

1. **비차단 preflight를 먼저 연결한다.**
   Worktree 생성 직전에 current workspace id와 origin context를 해석해 Sidebar Manager의
   `groups/mutation-check`와 동등한 policy resolution을 호출한다. 결과는 badge/warning/softRejection으로만
   표시하고, hard block은 만들지 않는다(§4.1/§4.4).
2. **정책 판정과 예외 기록을 남긴다.**
   `read-only`/`self-contained`/`contract`이면 경고와 `detail`, `hint`를 표시하고, 사용자가 진행할 경우
   workspace id, policy, worktree path, session id, 시각을 audit record로 남긴다.
3. **cwd 변경은 handoff 또는 명시적 transition으로 바꾼다.**
   live session을 조용히 이동하지 말고 new session id + `parentSession`을 쓰거나,
   `previousWorkingDirectory`/`worktreePath`를 session metadata에 기록한다.
   Sidebar fingerprint/member mapping은 이 transition을 감지해 stale 표시해야 한다.
4. **worktree 신원과 수명주기를 소유·기록한다.**
   기본은 workspace registry 등록이 아니라 session-scoped checkout으로 두되,
   `sourceWorkspaceId`, `repositoryRoot`, `branch`, `baseCommit`, `sessionId`를 매핑한다.
   prune/rollback은 preview → apply, `git worktree list --porcelain` 검증, uncommitted 보존을 전제로 한다.
5. **contract advisory를 보강한다.**
   `.agents/worktrees` 같은 runtime artifact를 contract node observation에 추가한다.
   단, 이것도 hard block이 아니라 `notice`/`policy` observation이어야 한다.
6. **실측 테스트 매트릭스를 추가한다.**
   isolated `DSH_HOME`에서 ① 일반 workspace ② Core-00-System(read-only) ③ Core-99-UROH(self-contained)
   각각 실제 Worktree 생성 → cwd/session log/`workspace.json`/groups fingerprint/`git worktree list`를
   before→after로 기록한다. 서버 재시작 후 재측정도 포함한다(R-M3/R-M4).
7. **문서/용어를 분리한다.**
   Forge의 "promotion"과 Sidebar Manager의 "promotion/preview|apply"는 다른 의미임을 UI/문서에 명시한다.

## 5. 최종 판정과 우선순위

**판정: APPROVE WITH CHANGES**

- P0: report §2의 source-inferred 항목을 "실측"에서 분리하고, 실제 Worktree 생성 및
  read-only/self-contained 멤버 재현 결과를 추가한다.
- P0: P0 권고를 "Worktree 비활성화"에서 "advisory preflight + warning + exception audit"로 수정한다.
  비활성화가 필요하면 `UTM-ARCHITECTURE-SPEC` 개정 또는 Master의 명시적 예외가 선행되어야 한다.
- P1: cwd 변경을 handoff/명시적 transition으로 설계하고 Sidebar fingerprint 재검증을 추가한다.
- P1: worktree 수명주기(등록 여부, prune/rollback 소유자)를 결정하고 audit record를 남긴다.
- P1: contract node의 `.agents/worktrees`를 advisory observation에 추가한다.
- P2: `gh` 미설정 표시, UI slot 근거, promotion 용어 구분을 보완한다.
