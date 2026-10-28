# Phase 5 — HQ 승격 · 배치 트랜잭션 · 레거시 분류 · 하네스 다이어트

> 상태: implemented · 2026-10-25 · 라이브 무접촉(사용자 수동 트리거 전까지)
> 기준 문서: `docs/dsh-plugin-runtime-spec.md` §2.1 / §2.2 (내부 권위)

## 1. HQ 생성 · 승격

- `lib/hq-promote.mjs`: `{GROUP}-00-{MAIN}` 스캐폴드 → `promotion/apply mode:"existing"` 위임.
- `previewHq()`: 빈 그룹/경로 이탈/제목 충돌/`INDEX≠00` 사전 차단, 읽기 전용.
- `scaffoldHq()`: `CAPSULE.md` + `.dsh-hq.json` 멱등 생성(이미 있으면 skip).
- 신규 라우트: `groups/hq/preview`(쓰기 0), `groups/hq/promote`.

## 2. 배치 리네임 (`rename-batch` 저널)

- `lib/batch-rename.mjs`: **3단계**(stage → rename → relocate/repoint).
- 스왑(`A→B`, `B→A`)은 `staging` 경로 경유로 충돌 회피.
- 실패 시 **역순 롤백**(파일 + 스냅숏), 부팅 시 `recoverBatchRename()`이 비종료 저널 복구.
- 감사 재사용: `planBatchRename()`이 `batch-validate.mjs`의 사전 검증 결과를 포함.
- 신규 라우트: `workspace/batch-rename/plan`, `workspace/batch-rename/status`.

## 3. Workspace Manager UI 완성

| 기능 | 구현 |
|---|---|
| 정렬 확인 다이얼로그 | 4개 항목 표시 + 체크 전 실행 버튼 disabled |
| HQ 생성 폼 | 그룹명/메인명 입력 → `groups/hq/promote` |
| 프로젝트 승격 폼 | 경로/제목 → `promotion/preview` + `promotion/apply` |
| 레거시 로그 스캔 | `groups/orphans`, **분류 전용(삭제 없음)** |

## 4. 레거시/고아 로그 분류기

- `lib/orphan-classifier.mjs` — **멤버십은 세션 ID 기준**(cwd 아님).
- 실측: `total 105 · bound 45 · unregistered 60`, 그중 **`total_skill` 23건** 정확히 식별.
- `destructive: false` — 로그 이동/수정/삭제 없음.

## 5. 하네스 다이어트

- `lib/templates/`: `CAPSULE.template.md`(≤400 tok), `AGENTS.sub.template.md`(≤600), `TOOL-REGISTRY.template.md`(≤120).
- `lib/harness-diet.mjs`: CJK 인식 토큰 추정 + 예산 검증(총 ≤1,500/sub) + 중복 캡슐 탐지.
- **그룹 간 fork 금지**: `checkCrossGroupFork()` + `groups/fork-policy` 라우트.

## 6. 검증

| 항목 | 결과 |
|---|---|
| 전체 테스트 | **86 / 86 통과** (manifest 7 · promotion 18 · safety 17 · rollback 5 · groups-v2 10 · hq-tree 7 · phase5 22) |
| 세션 바인딩 | **105 / 105 정상** |
| 고아 분류 | 60건(=`total_skill` 23건 포함), 비파괴 |
| 정렬 프리뷰 | `UTM → UROH → …`, 이동 2건 |
| HQ 프리뷰 | `UTM-00-Core`, 쓰기 0 |
| 라이브 `~/.dsh` | **무변경** (`groups.json` 미생성, `workspace.json` mtime 불변) |
