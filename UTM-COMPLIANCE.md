# UTM 거버넌스 준수 감사 — 플러그인 통합 사전 검증
<!-- skeleton:
version: 1.0
kind: report
status: reference
updated: 2026-10-24
summary: UTM governance compliance matrix recovered from session logs; UTM itself was lost in migration.
-->


> 상태: active · 최종 갱신: 2026-10-24 · 상위: [README](README.md) · 대상: `dsh-sidebar-manager`, `dsh-notify`

## 0. 요약 (핵심 판정)

**UTM 하네스는 이 Linux 머신에 물리적으로 존재하지 않는다.** 따라서 "UTM 스펙 준수 여부 검사"는
UTM 저장소 파일을 기준으로 할 수 없고, **UTM 세션 로그에서 복원한 계약**과 **DSH 자체 불변식**을
기준으로 수행했다. 플러그인 통합 자체는 가능하나, **UTM 원장(ledger) 연동은 현재 불가**하다.

| 구분 | 판정 |
|---|---|
| UTM 디렉토리 | **비어 있음** (inode 1, 2026-10-24 17:43 생성) |
| UTM 원장 `~/.dsh/governance/ledger/` | **부재** (Linux로 이관되지 않음) |
| UTM 계약 복원 | 세션 로그 6개에서 47개 문서 복원 (`/tmp/utm-src/`) |
| 플러그인 A (sidebar) | DSH rc.3 호환 **검증됨**, 결함 1건 수정 |
| 플러그인 B (notify) | 테스트 19/19, 보안 컨텍스트 결함 수정 |

## 1. UTM이란 무엇인가 (로그 복원 결과)

`~/.dsh/storages/workspace.json`의 워크스페이스 `90bee0c6-a98f-4976-8ac8-b75bc384e230`이
제목 **UTM**으로 등록되어 있고, 경로는 `/home/minami/Workspace/projects/project-promotion-manager`이다.

세션 로그 복원 결과 UTM의 실체는 **Universal Project Manager (UPM)** 라는 "거버넌스 OS"이며
(README.md, git main @ 43da1a4), Rust/Node 혼합이 아니라 순수 Node ESM 모노레포다.

```
packages/
  governance-core/        런타임 중립: 원장 스키마·상태기계·저널·provider 계약
  provider-dsh/           DSH 어댑터 + DSH 전용 도구
    tools/session-migrate/   로그 프레임 파서 · R1~R5 검증기
    tools/promote-and-restart.ps1   live 세션 정지 창 실행기
```

**중요**: `provider-dsh`가 감싸는 어댑터가 바로 이번 대상 **`@nolit/dsh-sidebar-manager`**이다.
즉 Plugin A는 UTM의 실행 엔진이며, UTM은 Plugin A의 거버넌스 상위 계층이다.

## 2. UTM 불변 조건 (BOOT-CARD 7조) 대비 준수 매트릭스

출처: `docs/workspace-promotion/BOOT-CARD.md` (세션 로그 복원)

| # | 불변 조건 | Plugin A 실제 구현 | 판정 |
|---|---|---|---|
| 1 | `workspace.json` 직접 편집 금지, `ctx.workspaceRegistry` 필수 | 변경은 전부 `registry.create/archiveSession/unarchiveSession` 사용 | **준수** (경미 예외 §2.1) |
| 2 | 세션 로그 이동은 cold일 때만 | preview 단계에서 live 차단, `restartRequired` 반환 | **준수** |
| 3 | finalize 순서 detach → attach | `registry.create` 후 attach, 실패 시 `rollbackJournal` | **준수** |
| 4 | `workspace.json` 전체 복원 금지, 대상만 되돌림 | `rollbackJournal`이 백업본 전체를 `restoreWorkspaceFile`로 복원 | **위반 소지** (§2.2) |
| 5 | Type B는 boot finalizer에서 workspace 생성 | `finalizePending`가 `apply()`에서 실행 | **준수** |
| 6 | 검증 중 live 세션 이동 금지 | live 세션 blocker 처리 | **준수** |
| 7 | carry는 명시 경로만, 심볼릭 링크·상위 탈출 금지 | `folderName`에 `/`, `\`, `.`, `..` 차단 + `isUnder(projectsRoot)` 경계 | **부분 준수** (§2.3) |

### 2.1 예외: `readWorkspaceFile` (읽기 전용)

`defaultWorkspaceId()`가 `storages/workspace.json`을 직접 **읽는다**(쓰기 아님).
기본 워크스페이스 여부를 판정하는 blocker 용도로만 쓰이며, RC.3 공개 API에 해당 getter가 없어
불가피한 부분이다. **리스크: 낮음** — 스테일 읽기 시 잘못된 blocker만 발생하고 데이터 손상은 없다.

### 2.3 부분 준수: 불변조건 7 (carry 경계)

폴더 이름 승격은 `folderName`에 `/`, `\`, `.`, `..`를 차단하고(`FOLDER_INVALID`), 부모 경로에만
생성하므로 **상위 탈출은 불가**하다. 다만 원 불변조건의 "`.git` / `node_modules` / symlink 금지"에
해당하는 **명시적 검사는 없다**. 실제 위험도는 낮은데, 승격 대상이 git 저장소 루트인 경우
`.git`·`node_modules`가 함께 `rename`되기 때문이다(이동이지 복사가 아니므로 데이터 손상은 없으나,
레지스트리 경로만 바뀌고 ignore 정책은 그대로다). 필요 시 `FOLDER_INVALID` 옆에 `.git` 존재
검사 blocker를 추가하는 것이 UTM 원 스펙과 일치한다.

### 2.2 위반 소지: `restoreWorkspaceFile` (전체 파일 복원)

```js
// lib/transaction.mjs:189
function restoreWorkspaceFile(options, backupDir) {
  const source = path.join(backupDir, 'workspace.json')
  if (!fs.existsSync(source)) return
  fs.mkdirSync(path.join(options.dshHome, 'storages'), { recursive: true })
  fs.copyFileSync(source, path.join(options.dshHome, 'storages', 'workspace.json'))
}
```

롤백 시 백업 시점의 `workspace.json` **전체를 덮어쓴다**. 백업 이후 다른 세션/워크스페이스가
추가됐다면 그 변경이 소실된다. 이는 BOOT-CARD 불변조건 4의 "대상 workspace/세션만 되돌린다"에
정면으로 어긋난다.

**권고**: 롤백을 `registry` 역연산 트랜잭션으로 바꾸거나, 최소한 백업 시점 대비 diff된
워크스페이스 레코드만 복원하도록 축소할 것. (본 감사에서는 **동작 변경 리스크**가 커서
수정하지 않고 보고만 한다 — 사용자 결정 필요)

## 3. DSH 자체 불변식 준수

UTM은 "코어는 런타임을 모른다"지만, Plugin A는 DSH 전용 어댑터이므로 DSH 불변식을 따라야 한다.

| DSH 불변식 | 실측 결과 |
|---|---|
| Frame 1 = 헤더 JSON 1줄 + `\n` | 97개 로그 전수 검사 통과 |
| `assertStoredIdentity`: 파일 위치 == `projectKey(header.cwd)` | `projectKey`/`encodeSegment` 디스크 경로 100% 일치 |
| `assertZstdHeaderFrame` | `readLogFile`이 헤더 프레임 1줄 강제 |
| 세션 ID 인코딩 (`session-` 접두사) | `encodeSegment` 처리 |
| projcache `identity.cwd` = 헤더 cwd | `patchProjcache`가 identity와 `rows.workingDirectory` 동시 갱신 |

### 3.1 명세 정정: 세션 로그는 "2프레임"이 아니라 N프레임

기존 `MIGRATION.md`는 로그를 "exactly two frames"로 기술하지만, **라이브 로그 실측 결과**는 다음과 같다:

```
logs: 97
frame-count histogram: {"2":87,"3":2,"5":1,"243":1,"296":1,"357":1,"498":1,"604":1,"739":1,"755":1}
```

DSH writer는 헤더 프레임 1개 + 이벤트 프레임 N개로 증분 append한다. `session-log.mjs`는
`frames.slice(1)`로 모든 이벤트 프레임을 보존하므로 **코드는 정확**하고 문서만 부정확하다.

## 4. Windows → Linux 메타데이터 이관 적합성

| 항목 | 실측 | 판정 |
|---|---|---|
| UTF-8 인코딩 | 플러그인 전체 `.js/.mjs/.json/.md/.yml` 전수 `iconv` 통과 | **PASS** |
| BOM | 0건 | **PASS** |
| CRLF | 0건 | **PASS** |
| Windows 경로 리터럴 (`C:\`, `%USERPROFILE%`) | 플러그인 코드 0건 | **PASS** |
| 경로 구분자 처리 | `'/'`·`'\\'`·`':'`를 모두 구분자로 처리(Windows 로그 호환 유지) | **PASS** |
| 워크스페이스 7개 경로 실재·정규화 | 전부 `realpath` 일치 | **PASS** |
| 파일 권한 | `workspace.json` 0600, 세션 로그 0600, 디렉토리 0775 | **PASS** |
| world-writable | `profiles/web/node_modules/@nolit/dsh-korean-locale` 심볼릭 링크 1건(정상) | **PASS** |
| 한글 경로 | `기본 작업공간` 정상, 구 Windows `문서` 경로 잔존 없음 | **PASS** |

## 5. 결론 및 권고

1. **UTM 하네스 복원이 선행되어야 한다.** 현재 UTM 워크스페이스는 빈 디렉토리이고 원장이 없다.
   이 상태에서 "플러그인이 UTM 라이프사이클 훅을 호출한다"고 주장할 수 없다.
2. **플러그인 A 통합은 기술적으로 승인 가능**, 단 §2.2 롤백 결함을 먼저 처리할 것을 권고.
3. **UTM 부재 시 폴백**: Plugin A의 journal(`~/.dsh/sidebar-manager/journal/pending.json`)이
   이미 txid/state/backupDir를 남기므로, 이를 UTM 원장 스키마로 승격하는 어댑터가 M5 계약
   (`promotion.apply → {txid, workspaceId, sessionIds, restartRequired, journalPath, recordHash}`)의
   최소 구현이 된다.
