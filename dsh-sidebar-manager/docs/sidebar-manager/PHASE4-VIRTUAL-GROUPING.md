# Phase 4 — 가상 그룹화 하네스 (HQ 트리 · 정렬 · 시스템 분리)

<!-- skeleton:
version: 1.0
kind: report
status: completed
updated: 2026-10-29
summary: Phase 4 record: the virtual grouping harness, HQ tree ordering, and separation of system entries.
-->


> 상태: implemented · 2026-10-25 · 네이티브 사이드바 무접촉
> 선행: [Phase 1–3](PHASE1-3-IMPLEMENTATION.md), 감사 A–F (`projects/project-promotion-manager/docs/audit/` — sibling repo, not in this workspace)

---

## 1. 설계 불변식 준수

| 지시 | 구현 |
|---|---|
| Title 정본 / Path 파생 | `groups.json` 메타데이터만 사용. 경로 미변경 |
| 평면 형제 + 논리 중첩 | 물리 디렉터리 중첩 없음. `buildHqTree`가 논리 트리만 생성 |
| `{GROUP}-00-{MAIN}` = 관제탑 | `indexValue === 0` → `hq`, 나머지는 `modules` |
| `UTM`/`UROH` = `kind:"system"` | v2 스키마 + `pinTop` + 상단 고정 정렬 |
| 네이티브 사이드바 불변 | DOM 조작·CSS 주입·마이크로폰트 **전무**(소스 검증: `MutationObserver|querySelector|data-row-key|YDXeBa` 0건) |
| 공식 계약만 사용 | `ctx.slots.*`, `uiWorkspace.openWorkspace`, `registry.insertBefore` |
| 레코드 단위 롤백 | Phase 1의 `backupWorkspaceRecords`/`restoreWorkspaceRecords` 유지 |

---

## 2. `groups.json` v2 스키마

```json
{
  "unit": { "name": "sidebar-groups", "version": 2 },
  "groups": [
    { "groupId": "core", "label": "Core", "order": -1, "kind": "system", "pinTop": true, "color": "#7c3aed" },
    { "groupId": "g-utm", "label": "UTM", "order": 0, "kind": "project", "index": "00", "color": "#2563eb" }
  ],
  "members": {
    "<UTM-id>": { "groupId": "core", "order": 0, "fingerprint": { "path": "...", "title": "UTM" } }
  }
}
```

- `kind`: `system` | `project` (미지정 시 `project`)
- `pinTop`: 정렬 시 최우선 배치
- `color`: `#rgb`~`#rrggbbaa`
- **v1 → v2 마이그레이션**: `migrateDocument()`가 additive 변환(데이터 손실 0)

---

## 3. 구현 모듈

| 파일 | 역할 |
|---|---|
| `lib/groups.mjs` | v2 스키마·검증·마이그레이션·`planSidebarOrder` |
| `lib/hq-tree.mjs` | HQ/모듈 논리 트리 파생 (순수 함수) |
| `lib/transaction.mjs` | `workspace/order/preview`, `workspace/order/apply`, `groups/view` |
| `lib/client.js` | `GroupTreeSection` — Manager `main` 패널 내 HQ 트리 |

### 3.1 신규/확장 라우트

- `groups/view` — HQ 트리 + 정렬 요약 (읽기 전용)
- `workspace/order/preview` — 목표 순서 + 이동 목록 (**쓰기 0**)
- `workspace/order/apply` — `insertBefore` 체인 실행, **역순 롤백**

### 3.2 정렬 규칙

```
system 그룹(pinTop) → project 그룹(group.order, index) → 그룹 내 {INDEX} 정수 오름차순 → 미분류
```

`{INDEX}`가 권위이며 `member.order`는 동률 tie-breaker로만 사용.

---

## 4. 검증 결과

### 4.1 테스트 (57/57)

| 파일 | 개수 | 범위 |
|---|---:|---|
| `promotion.test.mjs` | 18 | 승격 엔진 회귀 |
| `safety.test.mjs` | 17 | 스키마·fallback·배치 검증 |
| `rollback.test.mjs` | 5 | 레코드 단위 롤백 |
| `groups-v2.test.mjs` | 10 | v2 스키마·정렬·apply 롤백 |
| `hq-tree.test.mjs` | 7 | HQ 식별·롤업·제안 그룹 |

### 4.2 실제 상태 E2E (읽기 전용)

```
workspaces: 7 | session logs: 105 healthy=105 issues=0
schema version: 2 status: ok
 [system] Core  HQ=none modules=2 sessions=9
 [project] DSH  HQ=none modules=1 sessions=11
 ungrouped: 투데이웍, 기본 작업공간, Total Skill Addon, Skill Intelligence
 target order: UTM | UROH | DSH Plugins | ... (moves=3)
 live groups.json created? false
 live workspace.json mtime: unchanged
```

→ **시스템 코어 상단 배치가 계획대로 계산됨**, 세션 바인딩 105/105 무손상, **라이브 상태 무변경**.

---

## 5. 롤백 안전성

`workspace/order/apply`는 각 `insertBefore` 직전의 전체 순서를 기록하고, 실패 시 **역순으로 재적용**한다.
테스트 `route: order/apply rolls back when insertBefore fails mid-flight`가
2번째 호출 실패 후 **원래 순서 완전 복원**을 검증한다(HTTP 409 + `rolledBack: true`).

---

## 6. 남은 작업 / 제약

1. **실제 정렬 실행은 사용자 액션** — 본 구현은 preview/apply 라우트만 제공하며 자동 적용하지 않는다.
2. **HQ 미지정 그룹** — 현재 라이브 데이터에서 `-00-` 명명 워크스페이스가 없어 `hq: null`로 표시됨(정상).
   `00` 관제탑을 만들려면 별도 승격 작업이 필요(Phase 5 후보).
3. **`uiWorkspace.openWorkspace` 실패** 시 알림만 표시(내비게이션은 네이티브 위임).
4. 루트 `AGENTS.md`/`CAPSULE.md` 도입(감사 C 권고)은 미적용 — 문서 계층은 Phase 5.
