# 복원력 보강 패치 보고 — @nolit/dsh-opencode-v2

<!-- skeleton:
version: 1.0
kind: report
status: applied-pending-restart
updated: 2026-11-05
summary: 2026-11-05 subagent 451/404 실패에 대한 재시도·부분산출물 보존·고아 정리 패치의 구현 범위, 검증 결과, 라이브 적용 상태.
-->

측정 시각: 2026-11-05 08:15–08:35 KST · 대상: `dsh-plugins/dsh-opencode-v2` + `dsh-plugins/dsh-antigravity`
버전: **`0.0.2-rc.2 → 0.0.2-rc.3`**, **`0.0.1-rc.4 → 0.0.1-rc.5`**. rc#는 에이전트 소유(세션당 1회 증가), 숫자 트랙은 소유자 소유.

---

## 1. 적용 내용

### (1) HTTP 재시도 — `lib/http.js`

| 항목 | 값 |
|---|---|
| 재시도 상태 | `429, 451, 502, 503, 504` (`httpRetryStatuses`, 기본값) |
| 횟수 | `httpRetries = 3` (기본) — 최초 시도 + 3회 재시도 |
| 백오프 | `httpRetryBaseMs = 1000` → **1s, 2s, 4s** 지수 |
| 제외 | 400/401/403 — 자격증명/요청 자체가 틀린 경우라 재시도 무의미 |
| 적용 지점 | non-2xx 응답 직후, 스트림 시작 전(델타 0). 재시도 중에는 모델 verdict를 기록하지 않고 **최종 거부만** 기록 |

- abort 지원: 백오프 중 호출자 취소 시 `ABORTED`로 즉시 종료.
- 기존 `streamCutPreserve`(스트림 절단 시 부분 출력 보존)와 별개로 동작.

### (2) 로컬 데몬 404 재해석 — `lib/http.js` `ServerManager.request`

- `GET /api/provider/{id}`가 404면 **백엔드를 재해석한 뒤** `daemonRetries = 3`, 백오프 1s→2s→4s로 재시도.
- 기존에는 `error.status`가 있으면 즉시 throw → 턴 사망. 이제 stale 데몬/교체된 데몬을 복구 가능.
- 그 외 네트워크 오류(non-owned endpoint)도 동일 루프에서 3회까지 재시도.

### (3) 부분 산출물 보존 — 신규 `lib/resilience.js`

- 자식 세션 `turn/end`가 `error` 또는 `aborted`면 **salvage manifest** 기록:
  - 위치: `$DSH_HOME/opencode-v2/salvage/<childSessionId>.json` + `.md` (`salvageDir`로 변경 가능)
  - 내용: child/parent 세션 id, cwd, 실패 시각·사유(코드/메시지), **자식 생성 이후 변경된 파일 목록**(path/bytes/mtime, 최대 `salvageMaxFiles=200`, `node_modules`·`.git` 등 제외), 세션 로그 힌트
  - 파일은 **그대로 둔다**(이동/삭제 없음). 부모가 재실행 없이 산출물을 찾을 수 있게 하는 색인이다.
- 기록 실패는 로그만 남기고 세션에 영향을 주지 않음.

### (4) 고아 자식 정리 — 신규 `lib/resilience.js`

- **즉시 트리거**: 부모 세션의 `turn/end`가 `error`/`aborted`면 그 세션의 실행 중 자손을 `child.cancel({kind:'parent'})`.
- **주기 스윕**: `orphanSweepMs = 60000`마다, `origin: 'subagent'`이면서 status `running`인 에이전트 중 **부모 체인이 live 에이전트 목록에 없는** 경우 취소. (설치된 `dsh-subagent`의 archive admission과 동일한 `agents.list()`/`cancel` 메커니즘.)
- 옵트아웃: `orphanCleanup: false`.

### (5) 안티그래비티 동반 보강 — `dsh-antigravity`

OpenCode HTTP 라우트만 보강하면 같은 서브에이전트가 쓰는 안티그래비티 라우트가 더 약한 고리로 남는다.

| 항목 | 값 |
|---|---|
| 재시도 상태 | `429, 451, 500, 502, 503, 504` (`httpRetryStatuses`) |
| 횟수/백오프 | `httpRetries = 3`, `httpRetryBaseMs = 1000` → 1s/2s/4s |
| 401 | 토큰 invalidate 후 **1회만** 재시도(새 토큰 재취득). 두 번째 401은 `AUTH` |
| 403/404 | 재시도 안 함(자격증명/모델 문제) |
| 구현 | `lib/adapter.js` `#generate`의 token→fetch→non-ok 구간을 재시도 루프로 교체, `configValue`로 설정 읽기 |

- 부분 산출물 보존·고아 정리는 `session/event`·`agents` 레지스트리를 보므로 **provider와 무관**하게 안티그래비티 자식에도 적용된다(공통 `lib/resilience.js`가 opencode-v2-http 엔트리에서 설치됨).

### (6) 부수 수정

- `costPath`가 코드에서 읽히는데 `Config` 스키마에 없어 프로필 설정이 무시되던 문제 → 스키마에 추가.
- `npm run check`에 `lib/resilience.js` 추가.

### 버전

| 패키지 | before → after | 근거 |
|---|---|---|
| `@nolit/dsh-opencode-v2` | `0.0.2-rc.2` → **`0.0.2-rc.3`** | 이 세션에서 수정, rc# 1회 증가 |
| `@nolit/dsh-antigravity` | `0.0.1-rc.4` → **`0.0.1-rc.5`** | 같은 이유 |

### 변경 파일

| 파일 | 변경 |
|---|---|
| `dsh-opencode-v2/lib/http.js` | +163 −8: 재시도 루프·백오프·데몬 404 재해석·설정 6개·resilience 설치·VERSION rc.3 |
| `dsh-opencode-v2/lib/resilience.js` | 신규 333줄 |
| `dsh-opencode-v2/test/http.test.mjs` | +4 케이스(451 재시도 성공, 503 상한, 데몬 404 복구, 403 비재시도) + 테스트 원장 격리 |
| `dsh-opencode-v2/test/resilience.test.mjs` | 신규 8 케이스 |
| `dsh-antigravity/lib/adapter.js` | 재시도 루프·백오프·401 1회 갱신 |
| `dsh-antigravity/lib/index.js` | `httpRetries`/`httpRetryStatuses`/`httpRetryBaseMs` 설정 |
| `dsh-antigravity/test/adapter.test.mjs` | +4 케이스(429→성공, 503 상한, 401 갱신, 403 비재시도) |
| 양쪽 `package.json`/`CHANGELOG.md`/README | rc bump 및 기록 |

---

## 2. 검증

- `dsh-opencode-v2`: `npm test` → **425/425 pass**, `npm run check` OK.
- `dsh-antigravity`: `npm test` → **94/94 pass**, `npm run check` OK.
- 신규 테스트가 실제로 검증하는 것:
  - 451 1회 후 성공: 요청 2회, 최종 `stop`
  - 503 반복 + `httpRetries:2`: 요청 3회, 최종 `OPENCODE_BACKEND_HTTP`(503)
  - provider 404 1회 후 200: provider 조회 2회 이상, 최종 `stop`
  - 403: 요청 1회, `OPENCODE_BACKEND_AUTH` (재시도 안 함)
  - 부모 turn 실패 → 자식 cancel 1회
  - 자식 turn 실패 → manifest JSON/MD 생성, 파일·사유 포함
  - 부모가 live인 자식은 스윕에서 취소되지 않음

---

## 3. 라이브 적용 상태

- 라이브 프로필은 `~/.dsh/profiles/web/node_modules/@nolit/dsh-opencode-v2` → 이 트랙 **symlink**이므로 파일은 이미 라이브 경로에 있음.
- 그러나 실행 중인 데몬은 부팅 시 로드한 모듈을 계속 사용한다. 이 패치는 **`applied pending restart`** 상태다.
- **3080 데몬 재시작은 하지 않았다**: 이 대화 세션 자체가 그 데몬 위에서 돌고 있어 재시작하면 세션이 끊긴다. 재시작 시점은 소유자가 정해야 한다.

---

## 4. 요청 4번 — 72fa9915 강제 종료

**측정 결과: 이미 종료되어 있었다. kill할 프로세스가 없다.**

- 마지막 이벤트: `turn/end`, `seq 307`, `time 1793833245975` = **2026-11-05 08:00:45 KST**, `reason.kind = "completed"`.
- 세션 파일 mtime도 08:00:45에서 더 이상 증가하지 않음(확인 08:22).
- 즉 사용자 지시(08:14) 시점에 이 자식은 이미 정상 종료 후 결과를 부모에게 보낸 상태였다. "헛돌고 있는 고아"라는 전제는 그 시점 기준으로 사실이 아니었다.
- 새 패치의 스윕은 "부모가 live가 아닌 running 자식"만 취소한다. 이 자식은 부모(`e42cf5d8`)가 live였으므로 정상 작업으로 간주되어 취소 대상이 아니었다(설계상 맞음).

---

## 5. 남은 일

1. 데몬 재시작(소유자 승인 필요) → 패치 활성화. 재시작 후 로드 비콘(`0.0.2-rc.3` / `0.0.1-rc.5`)으로 확인 가능.
2. 숫자 트랙은 소유자 소유, rc#만 이번 세션에서 1씩 올렸다.
3. 재시작 전까지는 기존 동작(재시도 없음)이 계속된다.
