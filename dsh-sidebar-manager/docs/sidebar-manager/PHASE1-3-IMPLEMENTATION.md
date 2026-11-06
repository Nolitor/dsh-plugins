# Phase 1–3 구현 보고 — 안전한 가상 그룹 도입

<!-- skeleton:
version: 1.0
kind: report
status: completed
updated: 2026-10-29
summary: Phase 1-3 implementation record: introducing safe virtual grouping without touching the real workspace registry.
-->


> 상태: implemented (Phase 1–3) · 2026-10-25 · 실제 디렉터리 이동/벌크 rename은 **미수행**
> 근거: `../../docs/audit/` (00-SYNTHESIS, A-lifecycle, B-uiux, C-tokens)

## 1. 결정 반영

| Planner 결정 | 구현 |
|---|---|
| Title 정본 / Path 파생 | 그룹 멤버십은 `groups.json` 메타데이터. 경로를 그룹에서 파생하지 않음 |
| `00` 포인터 롤업 (물리 중첩 없음) | 평면 형제 가정. `parseGroupedName`은 제안용. 물리 부모 디렉터리 없음 |
| 독립 원자적 `groups.json` | `lib/groups.mjs` — temp+rename, `state.json`과 분리 |
| 파괴적 로그 마이그레이션 금지 | Phase 1–3에서 로그를 이동/삭제하지 않음. 바인딩은 **읽기 전용 감사**만 |
| 하이브리드 검증 | UI=사전검증(dry-run), core=최종 일관성(검증/재배정) |

## 2. Phase 1 — 안전 선행 조건

### 2.1 레코드 단위 롤백 (L4 수정)
- **이전**: `restoreWorkspaceFile()`가 `workspace.json` **전체**를 백업본으로 덮어씀 → 백업 이후 생성된
  워크스페이스 소실 (INCIDENT-2026-10-24 선례).
- **이후**: `backupWorkspaceRecords()` / `restoreWorkspaceRecords()`
  - 대상 레코드의 **pre-image만** 스냅숏 (`workspace-records.json`)
  - 롤백 시 해당 레코드만 복원, 삭제된 레코드는 재생성
  - `global.workspaceIds`는 원본 멤버가 **전부 존재할 때만** 복원하고, 그 사이 추가된 항목은 뒤에 보존
- 호출부 4곳을 스코프 지정으로 교체: purge / move / folder-rename / fork.

### 2.2 배치 검증 (`lib/batch-validate.mjs`)
`validateBatchRename()`가 파일/레지스트리를 **전혀 건드리지 않고** 검사:
- `FOLDER_SEPARATOR` / `FOLDER_DOT` / `FOLDER_BLANK` / `FOLDER_WHITESPACE`
- `TARGET_KEY_COLLISION` (`projectKey` 비단사 문제, L13 대응)
- `TARGET_EXISTS`, `SAME_PATH`
- `BATCH_SWAP_REQUIRES_STAGING` — 다른 워크스페이스의 **현재** 경로를 목적지로 삼는 경우 포함
- `REGISTERED_OUTSIDE_BATCH` 경고 (배치 밖 등록 보존 확인)
- `auditSessionBindings()` — 105개 로그의 `projectKey(header.cwd) == 디렉터리`, projcache `identity.cwd` 일치 검사

## 3. Phase 2 — `groups.json` 스키마

```json
{
  "unit": { "name": "sidebar-groups", "version": 1 },
  "groups": [{ "groupId": "g-dsh", "label": "DSH", "order": 0, "index": "00" }],
  "members": {
    "<workspaceId>": {
      "groupId": "g-dsh",
      "order": 0,
      "fingerprint": { "path": "/abs/path", "title": "DSH-00-Plugins" }
    }
  }
}
```

- 조회 순서: **`workspaceId` → `(path,title)` fingerprint → ungrouped**
- 재배정: `repointWorkspace({fromId,toId,...})` — `finalizeRename` / `handleRestoreWorkspace`에서 호출
  (두 경로 모두 워크스페이스 레코드를 **재생성**해 id가 바뀜)
- 제목만 변경 시 `refreshFingerprint()`로 fingerprint 갱신 (id 유지)
- 실패 시 **best-effort**: 그룹 재배정 실패가 완료된 파일 트랜잭션을 막지 않고 경고만 남김
- 손상/부재 시 `errors` 없이 빈 문서로 degrade (전부 ungrouped)

## 4. Phase 3 — Dry-run 검증 결과 (실데이터, 쓰기 0)

| 항목 | 결과 |
|---|---|
| 세션 바인딩 감사 | **105/105 healthy**, issues 0 |
| 명명 규칙 적합성 | 7/7 현재 미준수 (title·path 모두 ungrouped) — 예상대로, 그룹은 메타데이터로 부여 |
| 시뮬레이션 배치 (UTM→`UTM-00-Core`, UROH→`UTM-01-Release`) | `ok=true`, **blockers 0**, warnings 5 (`REGISTERED_OUTSIDE_BATCH`만) |
| 파일시스템 변경 | **0** — 목적지 경로 모두 `exists=false` 확인 |
| 레지스트리 시뮬레이션 (임시 stateDir) | 그룹 생성·할당·**id 변경 재배정** 정상, `staleIdHint=[]`, 재읽기 `status=ok` |
| 실 `~/.dsh/sidebar-manager/groups.json` | **생성되지 않음** (라이브 무접촉 확인) |

## 5. 테스트

`node --test test/promotion.test.mjs test/safety.test.mjs test/rollback.test.mjs` → **40/40 pass**

- `rollback.test.mjs` (5): 동시 등록 보존, 삭제 레코드 복원, 무관 레코드 불변, 스냅숏 범위 격리, 스냅숏 부재 no-op
- `safety.test.mjs` (17): 스키마 검증/원자성, id→fingerprint fallback, 재배정 멱등성, 빈 그룹 유지, swap 차단 등
- `promotion.test.mjs` (18): 기존 승격 엔진 회귀 없음

## 6. 남은 위험 / 다음 단계

1. **실제 배치 rename은 아직 없음** — `rename-batch` journal kind와 스테이징 경로 루프는 Phase 4.
2. **UI 미연결** — `groups/view`는 준비됨. 그룹 트리는 `sidebar.workspaces` 교체가 아니라
   `main` 패널 + `sidebar.panellist`로 붙여야 함(B 감사 U1/U32).
3. **`total_skill` 등 레거시** — 라벨링만. 23개 고아 로그는 Phase 4의 저우선 정리 대상.
4. **이중 유일성 규칙**(L2) — core `workspace/rename`으로 위임 권고, 미적용 상태.
5. 그룹 재배정 실패는 현재 **경고 후 진행**. 운영 전 알림 승격 여부 결정 필요.
