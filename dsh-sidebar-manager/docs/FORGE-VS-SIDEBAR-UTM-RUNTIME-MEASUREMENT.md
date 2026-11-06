# Forge Worktree × UTM 정책 — 실제 런타임 실측
<!-- skeleton:
version: 1.0
kind: measurement
status: measured
updated: 2026-10-29
summary: Isolated-DSH_HOME runtime measurement of Forge worktrees x Sidebar Manager v0.1.1 x UTM policy.
-->


> 상태: measured (isolated DSH_HOME) · 일시: 2026-10-29 · 대상: DSH `0.2.2-alpha.2`
> `@deepseek-ai/dsh-experimental-forge-bundle` + `@nolit/dsh-sidebar-manager` v0.1.1
> 선행 문서: [dsh-sidebar-manager/docs/FORGE-VS-SIDEBAR-UTM-MEASUREMENT.md](./FORGE-VS-SIDEBAR-UTM-MEASUREMENT.md),
> [dsh-sidebar-manager/docs/UTM-REVIEW-FORGE-VS-SIDEBAR.md](./UTM-REVIEW-FORGE-VS-SIDEBAR.md)
> 증거: `.runtime-measure/policy-measure/` (아래 §5)

## 0. 결론

실제 `dsh web` GUI에서 Worktree를 생성해 확인했다. **UTM `read-only` 및 `self-contained`
정책이 선언된 workspace에서도 Worktree 생성과 Session cwd 변경이 실제로 성공했다.**
다만 이것을 "hard 정책 우회"라고 부르면 틀린다. UTM §3.4는 **동일 workspace 내부
컨텍스트의 mutation은 항상 허용**하므로, 같은 workspace 안에서 만든 worktree는 UTM의
`read-only`/`self-contained` 정의상 직접 위반이 아니다.

실측으로 확인된 실제 문제는 다음 4가지다.

1. **정책 resolution 미호출**: Forge/WorktreeService는 `groups/mutation-check`나
   `evaluateMutation`을 전혀 호출하지 않는다. 따라서 동일 컨텍스트여도 UTM 정책 observation,
   badge, softRejection, audit record가 Worktree action에 대해 남지 않는다.
2. **`.agents` artifact 미탐지**: Worktree는 `<repo>/.agents/worktrees/<branch>`에 실제 생성됐지만,
   Sidebar Manager `groups/advisory`는 여전히 `info` 6건뿐이었다. `IMPLEMENTATION_ARTIFACTS`가
   `.agents`를 검사하지 않고 top-level 이름만 보기 때문이다.
3. **live Session cwd 무단 이동**: session id는 그대로인데 `working-directory/change` 이벤트로
   cwd가 worktree로 바뀌었다. UTM 구조 불변식 §5.4 "Live sessions are never moved — use handoff"와
   충돌한다.
4. **worktree 신원 미등록**: `workspace.json`/`groups.json` 어디에도 worktree 경로가 없다.
   UTM 그룹/정책과 worktree를 매핑할 수 없다.

## 1. 실측 구성

- live `~/.dsh`는 건드리지 않고, 기존 `.runtime-measure/home`을 복제한 **isolated `DSH_HOME`**에서
  실제 `dsh web`을 부팅했다.
- Git fixture 2개를 만들고 `groups.json`에 실제 UTM 정책을 부여했다.
  - `Policy Fixture RO` — `role: contract`, `policy.access: read-only`
  - `Policy Fixture SC` — `role: contract`, `policy.access: self-contained`
- 브라우저(Playwright/Chromium)로 GUI를 조작해 workspace 선택 → **Worktree** 옵션 선택
  (`From main` 표시 확인) → 메시지 전송까지 수행했다.
- 모델 호출은 `DEEPSEEK_API_KEY` 부재로 `MISSING_CREDENTIAL` 실패했지만, Worktree 생성은
  **첫 model step 이전 preStep에서 완료**됐다. 따라서 Worktree 생성/cwd 변경 측정에는 영향이 없다.

## 2. 실측 결과

### 2.1 read-only workspace — `Policy Fixture RO`

| 항목 | before | after |
|---|---|---|
| `git worktree list` | main 1개 | main + `dsh-c9d6c385-fb71` |
| branch | `main` | `main`, `dsh-c9d6c385-fb71` |
| `.agents/worktrees` | 없음 | 생성됨 (`.../policy-fixture/.agents/worktrees/dsh-c9d6c385-fb71`) |
| Session id | `session-c9d6c385-...` | **동일 id 유지** |
| Session cwd | `.../policy-fixture` | `.../policy-fixture/.agents/worktrees/dsh-c9d6c385-fb71` |
| `working-directory/change` | — | 기록됨 |
| `workspace.json` SHA-256 | `067eec...` | `067eec...` (직후 snapshot; worktree 미등록) |
| `groups.json` SHA-256 | `676fbf...` | `676fbf...` |
| UI 경고/softRejection | — | **없음** |

Session log 핵심 이벤트:

```json
{"type":"working-directory/change","data":{"cwd":".../policy-fixture/.agents/worktrees/dsh-c9d6c385-fb71"}}
{"type":"plugin:client-ui-forge/worktree","data":{"action":"created","worktree":{"path":".../policy-fixture/.agents/worktrees/dsh-c9d6c385-fb71","branch":"dsh-c9d6c385-fb71","from":"main","repositoryRoot":".../policy-fixture"}}}
```

### 2.2 self-contained workspace — `Policy Fixture SC`

| 항목 | before | after |
|---|---|---|
| `git worktree list` | main 1개 | main + `dsh-5a55857a-011f` |
| `.agents/worktrees` | 없음 | 생성됨 (`.../self-fixture/.agents/worktrees/dsh-5a55857a-011f`) |
| Session id | `session-5a55857a-...` | **동일 id 유지** |
| Session cwd | `.../self-fixture` | `.../self-fixture/.agents/worktrees/dsh-5a55857a-011f` |
| `workspace.json`/`groups.json` | `.agents` 참조 없음 | `.agents` 참조 없음 |
| UI 경고/softRejection | — | **없음** |

### 2.3 UTM advisory API 직접 확인

실제 Sidebar Manager route를 호출한 결과:

| 호출 | 결과 |
|---|---|
| `groups/advisory` | HTTP 200, `blocking:false`, observations **info 6건뿐**. `.agents`/worktree `notice` 없음 |
| `groups/mutation-check` (RO, origin=RO, action=write) | `allowed: true` |
| `groups/mutation-check` (RO, origin=SC, action=write) | `allowed: false`, `POLICY_READ_ONLY` softRejection |
| `groups/mutation-check` (SC, origin=SC, action=write) | `allowed: true` |

→ UTM 정책 자체는 정상 동작한다. 문제는 **Forge가 이 route를 호출하지 않는다**는 점이다.
→ 외부/다른 workspace 컨텍스트에서 Worktree를 만들면 UTM은 softRejection을 낼 수 있지만,
   현재 Forge 경로에는 그 연결이 없다.

## 3. 정적 확인과 교차 검증

- `dsh-experimental-client-ui-forge/lib/index.js:1254` → `worktrees.create(...)`
- `dsh-experimental-worktree/lib/index.js:301-303` → `workingDirectory.ensure`,
  `sandboxPolicy.resolve` (DSH sandbox policy일 뿐 UTM 정책 아님)
- `dsh-experimental-worktree/lib/index.js:335-347` → `git worktree add`
- `dsh-experimental-worktree/lib/index.js:359` → `workingDirectory.set(agent, path)`
- `dsh-sidebar-manager/lib/contract-advisory.mjs:112-149` → `ownContext` 동일 시 `allowed:true`
- `dsh-sidebar-manager/lib/contract-advisory.mjs:27-47,64-70` → top-level artifact만 검사,
  `.agents` 규칙 없음
- Forge/Worktree package 매니페스트에 `dsh-sidebar-manager` 의존성 없음

## 4. 판정 및 권고

**판정: UTM 정책의 "hard bypass"는 아니다. 그러나 정책 통합/관찰 공백은 실재한다.**

| 우선순위 | 권고 |
|---|---|
| P1 | Worktree 생성 직전에 비차단 advisory preflight 연결: current workspace id를 origin으로 `groups/mutation-check` 호출. 동일 컨텍스트면 `allowed:true`여도 observation/audit을 남김. hard block 금지 |
| P1 | `.agents` 및 `.agents/worktrees`를 contract advisory observation 대상에 추가 (top-level `.agents` 탐지 또는 recursive scan). `notice`/`policy` 수준만 허용 |
| P1 | cwd 변경은 live session in-place가 아니라 handoff(new id + `parentSession`) 또는 명시적 transition으로 전환 |
| P2 | Worktree identity(`sourceWorkspaceId`, `repositoryRoot`, `branch`, `baseCommit`, `sessionId`)를 session metadata에 매핑. `workspace.json` 등록 여부는 별도 정책 결정 |
| P2 | `gh` 미설치 환경 표시, promotion 용어 분리 등 기존 P2 유지 |

> UTM §4.1/§4.4에 따라 **Worktree 옵션 비활성화, hard write-block, tool quarantine은
> 정당화될 수 없다.** 위 권고는 모두 비차단 observation/advisory 범위여야 한다.

## 5. 증거 파일

- `.runtime-measure/policy-measure/ro-create-evidence.json`
- `.runtime-measure/policy-measure/sc2-create-evidence.json`
- `.runtime-measure/policy-measure/advisory-evidence.json`, `query-advisory-after.out`
- `.runtime-measure/policy-measure/c9d6c385.jsonl` (session log decode)
- `.runtime-measure/policy-measure/ro-after-create.png`, `sc2-after-create.png`
- Git fixtures: `.runtime-measure/policy-measure/policy-fixture`, `self-fixture`

## 6. 한계

- live `~/.dsh`의 실제 Core workspace를 변형하지 않았다. 대신 동일 `groups.json` 정책
  (`read-only`, `self-contained`)을 부여한 격리 fixture에서 재현했다.
- model turn은 API key 부재로 실패했다. Worktree 생성은 model 호출 전에 완료됐으므로
  Worktree/cwd/registry/advisory 측정에는 영향이 없다.
- Forge가 실제 외부 컨텍스트에서 worktree를 만드는 경로는 현재 GUI에 없어 재현하지 않았다.
  이 부분은 정적 분석상 "호출 없음"으로만 확인됐다.
