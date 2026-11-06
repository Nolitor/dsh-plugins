# Phase 6 — v3 역할 메타데이터 + 선택적 정책 (Advisory / Soft Lint)

<!-- skeleton:
version: 1.0
kind: report
status: completed
updated: 2026-10-29
summary: Phase 6 record: v3 role metadata and the advisory/soft-lint policy that never hard-blocks a write.
-->


> 상태: implemented · 2026-10-25 · **비차단 원칙**
> 선행: Phase 4–5, 감사 E/F, 기획자 정정(강제 차단 철회)

## 1. 설계 원칙

| 원칙 | 구현 |
|---|---|
| 하드 블록·격리·도구 비활성 **금지** | quarantine 없음, mutation tool 차단 없음 |
| 역할/정책은 **서술 메타데이터** | 파일 생성·실행에 영향 없음 |
| 위반은 **관찰·권고**로 표면화 | `observations[]`, soft rejection |
| 워크플로 자유 | `rename/move/promotion/order` 핸들러는 정책 미참조(테스트로 고정) |

## 2. `groups.json` v3 (additive)

```json
{
  "unit": { "name": "sidebar-groups", "version": 3 },
  "groups": [
    { "groupId": "core", "kind": "system" },
    { "groupId": "utm-impl", "kind": "project",
      "upstream": { "contractGroupId": "core", "contractSpec": "UTM-CONTRACT" } }
  ],
  "members": {
    "<id>": { "groupId": "core", "role": "contract",
              "policy": { "access": "read-only", "reason": "..." } }
  }
}
```

- `role`: `contract` | `implementation` (순수 라벨)
- `policy.access`: `read-only` | `self-contained` (선택)
- `group.upstream`: **단방향**(다운스트림→업스트림, system 그룹만, 자기참조 금지)
- v2→v3: 정책 미선언 = 기존과 동일 동작

## 3. 선택적 정책 (라이브 적용됨)

| 워크스페이스 | role | policy | 의미 |
|---|---|---|---|
| `Core-00-System` | contract | `read-only` | 마스터 스펙·전사 롤업 (참조 전용) |
| `Core-01-UTM` | contract | `read-only` | Core 정본 스펙을 **소비·라우팅**, 직접 변경 금지 |
| `Core-99-UROH` | contract | `self-contained` | 감사 추적·릴리스 베이스라인은 **UROH 내부에서만** 변경 |

**자기 컨텍스트 내 변경은 항상 허용** — 외부 컨텍스트에서만 soft rejection.

## 4. API

| 라우트 | 동작 |
|---|---|
| `groups/advisory` | 관찰 목록 + 정책 배지. **항상 200, `blocking:false`** |
| `groups/mutation-check` | 정책 위반 시 **HTTP 200 + 명시적 `softRejection`** (하드 블록 아님) |

`softRejection` 예시:
```json
{ "level":"policy", "code":"POLICY_READ_ONLY", "action":"write",
  "targetTitle":"Core-01-UTM", "originWorkspaceId":"...",
  "detail":"... is declared read-only; write from another workspace context is discouraged",
  "hint":"perform the change inside the target workspace, or update its policy metadata" }
```

## 5. 관찰 규칙 (비파괴)

- 계약 노드에 `package.json`/`node_modules`/소스/빌드산출물 등 발견 → **`notice` 배지만**, 파일은 그대로
- 정책 선언 → `info` 배지
- 실측: Core 3개 노드 관찰 결과 **`info` 3건, `notice` 0건** (구현 아티팩트 없음 = 정상)

## 6. 검증

| 항목 | 결과 |
|---|---|
| 전체 테스트 | **121 / 121 통과** (신규 15) |
| 계약 노드에 파일 생성 | **허용** (테스트로 증명) |
| 워크플로 라우트 정책 참조 | **없음** (소스 검사 테스트) |
| advisory API | **항상 200 / blocking:false** |
| v2→v3 마이그레이션 | 데이터 손실 0 |
| 라이브 `groups.json` | v3 검증 통과(`problems: []`) |
