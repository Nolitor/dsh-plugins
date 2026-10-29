# Change requests & worktrees 실측 · Sidebar Manager / UTM 정책 비교
<!-- skeleton:
version: 1.0
kind: measurement
status: measured
updated: 2026-10-29
summary: Change-requests/worktrees bundle measured against Sidebar Manager and UTM policy; overlap and risk.
-->


> 상태: measured · 최종 갱신: 2026-10-29 · 대상: `@deepseek-ai/dsh-experimental-forge-bundle` v0.2.2-alpha.2 · 런타임: DSH `0.2.2-alpha.2`

## 0. 결론

`Change requests & worktrees`는 DSH 0.2.2-alpha.2에 포함된 **공식 experimental bundle**이며
기본 프로필에서는 비활성이다. 격리 `DSH_HOME`에서 활성화해 실제 `dsh web`으로 부팅한 결과:

- Host rows: `forge`, `forge-github`, `forge-session`, isolated `forge-worktree`, `forge-panel`
- Client boot graph: `@deepseek-ai/dsh-experimental-client-ui-forge` 로드
- Git 작업공간에서 composer에 **Worktree** 옵션 표시
- Worktree 클릭 시 **From main** base branch 선택 UI 표시
- 콘솔/pageerror 0건
- `gh` CLI는 이 환경에 미설치 → GitHub change-request polling은 `gh auth login` 전까지 비활성,
  단 README가 명시한 대로 branch/worktree UI는 동작

현재 워크스페이스 관리자 및 UTM 정책과는 **기능 영역이 일부 겹치지만 목적과 데이터 모델이 다르다.**
가장 중요한 리스크는 Forge가 **UTM의 `read-only`/`self-contained` 그룹 정책을 조회하지 않는다**는 점이다.
단, 실제 read-only/self-contained 멤버에서 Worktree 생성을 재현한 것은 아니며, 이는
**정책 resolution 미호출이라는 구조적 리스크**로 한정해 해석해야 한다.

---

## 1. 실측 구성

라이브 `~/.dsh`는 읽기 전용이므로 workspace-local 격리 홈에 다음을 복제/구성했다.

- 라이브 `web` 프로필 package/patch
- `@nolit/dsh-korean-locale`, `@nolit/dsh-sidebar-manager`, `@nolit/dsh-notify-web`
- 라이브 `workspace.json` + `sidebar-manager/groups.json` 스냅샷
- `@deepseek-ai/dsh-experimental-forge-bundle` bundle 선택
- Git fixture: `.runtime-measure/forge-fixture` (`main`, fake `origin` remote)

실행:

```bash
DSH_HOME="$PWD/.runtime-measure/home" dsh web --no-open --host 127.0.0.1 --port 3099
```

## 2. 실측 결과

| 검증 | 결과 |
|---|---|
| Forge bundle Host row 구성 | PASS (`dsh --dump-config`) |
| Client boot entry | 76 entries, `dsh-experimental-client-ui-forge` 포함 |
| Git workspace composer | `Worktree` 표시 |
| Worktree 선택 후 | `From main` 표시 |
| 브라우저 오류 | console/pageerror 0 |
| `gh` CLI | 미설치 (`command not found`) |
| GitHub provider | `gh auth login --hostname <host>` 전까지 readiness 없음 |
| Worktree 생성 경로 | `source-inferred` — 실제 생성 미수행, `.agents/worktrees` 산출물 없음 |
| Worktree 생성 시 cwd 변경 | `source-inferred` — `ctx.workingDirectory.set` 호출은 코드 확인, 실제 cwd before→after 미측정 |

증거:

- `.runtime-measure/boot-forge.json`
- `.runtime-measure/dump-forge.yml`
- `.runtime-measure/measure-forge.json`
- `.runtime-measure/forge-ui.json`
- `.runtime-measure/forge-worktree.png`

---

## 3. Sidebar Manager / UTM과의 비교

| 축 | Change requests & worktrees | Sidebar Manager | UTM 정책 |
|---|---|---|---|
| 주 목적 | Git branch/worktree, PR/MR 추적 | workspace/session 구조 관리 | 그룹·계약/구현 역할·정책 |
| 작업 단위 | Session + Git checkout | Workspace + Session log + registry | Group + member role/policy |
| cwd 변경 | `ctx.workingDirectory.set` | move/fork/rename 시 session log의 `workingDirectory` 갱신 | 직접 cwd 변경 없음 |
| 파일시스템 | repo 내 `.agents/worktrees/*` 생성 | workspace 디렉토리 rename/move/archive/purge | projectsRoot 경계 검사 |
| 레지스트리 | 변경하지 않음 | `workspace.json` 변경 | `groups.json` v3 |
| Git 연동 | 강함 (branch/worktree/remote/PR) | 없음 (경로/세션 중심) | 없음 |
| 정책 집행 | DSH sandbox mode만 확인 | advisory soft lint + mutation-check | role/policy 정의 |
| UI 슬롯 | `sidebar.session.row.trailing`, `sidebar.session.row.hover`, `conversation.*`, `sidebar.right.pane.tab` | `sidebar.workspaces.session.row.action`, `sidebar.workspaces.session.menu.item`, `main`, `sidebar.panellist`, `shell.overlay` | UI 없음 |

### 3.1 겹치는 부분

1. **Session 작업 위치(cwd)를 바꾼다.**
   - Forge: Git worktree로 checkout을 새로 만들고 그 디렉토리로 Session cwd를 옮긴다.
   - Sidebar Manager: session log/registry를 갱신해 workspace 이동·fork·rename을 수행한다.
2. **`promotion`이라는 단어를 공유하지만 의미가 다르다.**
   - Forge: change request / PR 준비·병합 흐름.
   - Sidebar Manager: 프로젝트/워크스페이스 승격(`promotion/preview`, `promotion/apply`).
3. **Session 행 UI를 동시에 확장한다.**
   - Forge: branch/PR 상태 glyph.
   - Sidebar Manager: 그룹/HQ 트리와 row action/menu.
   - 슬롯 이름은 달라 직접 충돌은 확인되지 않았다.

### 3.2 실질적 리스크

- **UTM 정책 advisory 미표면화 위험**: Sidebar Manager의 그룹 `policy.access = read-only`는 advisory이며,
  Forge/Worktree는 policy resolution(`groups/mutation-check` 등)을 호출하지 않는다.
  따라서 cross-context 여부가 UI에 observation으로 surface될 기회가 없다. 동일 workspace 내부 mutation은
  UTM §3.4상 허용되므로, 이를 단순 “hard 우회”로 단정하지 않는다. 실제 read-only 멤버 재현은 후속 과제다.
- **cwd 이중 변경**: Sidebar Manager로 workspace를 이동한 Session에 Forge Worktree를 적용하면
  최종 cwd는 worktree가 된다. 이후 Sidebar Manager의 경로 기반 그룹 fingerprint가 stale될 수 있다.
- **workspace registry 비인지**: Forge worktree는 `workspace.json`에 등록되지 않는다.
  Sidebar Manager UI/UTM 그룹은 이를 별도 workspace로 보지 않으므로, worktree 안의 Session이
  어느 그룹/정책에 속하는지 표시가 불명확해질 수 있다.
- **prune/rollback 경계**: Sidebar Manager의 batch rename·rollback은 workspace 경로를 다루고,
  Forge는 Git worktree 메타데이터를 소유한다. 서로의 정리 책임을 모르므로 worktree가
  `.agents/worktrees`에 retained artifact로 남을 수 있다.

---

## 4. 권고

| 우선순위 | 권고 |
|---|---|
| P0 | Forge Worktree 생성 직전에 **비차단 advisory preflight**를 연결: workspace id/context 해석 → `groups/mutation-check` 동등 정책 판정 → badge/warning/softRejection. hard block/옵션 비활성화는 UTM §4.1/§4.4와 충돌하므로 금지 |
| P1 | Session cwd 변경을 handoff 또는 명시적 transition으로 설계하고, Sidebar Manager의 그룹 fingerprint/멤버십이 이를 감지해 stale 표시하도록 보완 |
| P1 | Worktree를 workspace registry에 등록할지, session-scoped checkout으로만 둘지 정책 결정 |
| P1 | 실제 Worktree 생성 테스트 매트릭스: 일반/read-only/self-contained 멤버에서 cwd·session log·workspace.json·groups fingerprint·`git worktree list` before→after 기록 |
| P2 | Forge `promotion`과 Sidebar Manager `promotion` 용어를 UI/문서에서 구분 |
| P2 | `gh` 미설치 환경에서는 change-request 영역을 명확히 “미설정”으로 표시하고 Worktree만 활성 |

## 5. 최종 판정

- Forge bundle은 alpha.2에서 정상 부팅·렌더링된다.
- Sidebar Manager/UTM과 **직접 슬롯 충돌은 없으나 cwd·경로·정책 의미에서 부분 중첩**이 있다.
- 특히 UTM 정책이 Forge worktree를 통제하지 못하는 점은 실제 운영 전 반드시 보완해야 한다.


---

## 6. UTM 하네스 리뷰 반영

UTM 거버넌스 리뷰 결과는 [`UTM-REVIEW-FORGE-VS-SIDEBAR.md`](./UTM-REVIEW-FORGE-VS-SIDEBAR.md)에 있다.

- 판정: **APPROVE WITH CHANGES**
- 핵심 수정: source-inferred 항목과 실제 측정 항목 분리
- P0 권고 수정: “Worktree 비활성화” → **비차단 advisory preflight + warning + exception audit**
- 후속 필수: 실제 Worktree 생성 전/후 측정, cwd handoff, worktree identity/lifecycle mapping,
  contract advisory에 `.agents/worktrees` 추가

---

## 7. 실제 런타임 실측 추가 (2026-10-29)

위 §2의 Worktree 생성 경로/ cwd 변경은 source-inferred였다. 후속 실측에서 isolated
`DSH_HOME` + 실제 `dsh web` GUI로 read-only/self-contained workspace에서 Worktree를
실제 생성했고, `.agents/worktrees` 생성·session cwd 변경·registry 미등록·advisory 미탐지를
before→after로 확인했다.

- 결과: [`FORGE-VS-SIDEBAR-UTM-RUNTIME-MEASUREMENT.md`](./FORGE-VS-SIDEBAR-UTM-RUNTIME-MEASUREMENT.md)
- 핵심 정정: "read-only 정책 hard bypass"가 아니라 **동일 컨텍스트 Worktree 생성은 UTM §3.4상
  허용되지만, Forge가 policy resolution을 호출하지 않아 observation/audit이 남지 않는 공백**이다.
