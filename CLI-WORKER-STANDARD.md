# CLI 워커 공통 규격 · 개별 규격 정리 (`/ocode`, `/agy`)

OpenCode CLI와 Antigravity CLI(`agy`)를 같은 DSH 워커 도구로 다루기 위한 비교 정리.
측정 환경: `opencode` v2.2 계열(`~/.bun/bin/opencode`), `agy` 1.4.10, Linux.

## 1. 공통 표준 (두 CLI 모두 성립)

| 항목 | 공통 동작 |
|---|---|
| 실행 형태 | 단발(headless) 호출. 프로세스 1개 = 작업 1건 |
| 작업 디렉터리 | 자식 프로세스의 `cwd`가 곧 워크스페이스 |
| 모델 지정 | 실행 인자로 모델 id 전달 |
| 출력 | JSON 계열 출력 모드 지원 |
| 종료 판정 | 프로세스 exit code + 응답 상태 |
| 권한 | 비대화 자동 승인 플래그 존재 |
| 자격증명 | CLI가 자체 보관·인증. 플러그인은 관여하지 않음 |
| 대화 맥락 | 부모 대화를 넘기지 않음(작업 텍스트만 전달) |

이 7개가 공통분모이므로, **도구 계약(파라미터·결과·산출물 표기)은 하나로 통일**할 수 있다.

## 2. 호환되지 않는 개별 규격 (반드시 분기 필요)

| 항목 | OpenCode | Antigravity (`agy`) | 영향 |
|---|---|---|---|
| 프롬프트 전달 | `run [flags] [<message...>]` + stdin 가능 | **argv `-p <prompt>` 전용** (`-p -`는 stdin을 읽지 않음, 실측) | 길이 상한이 갈림 |
| 프롬프트 길이 | stdin 경유 → 사실상 무제한 | **단일 인자 131,072바이트 하드 리밋** (실측: 131,000 ok / 131,072 E2BIG) | 긴 작업은 agy에서 거부 또는 stream-json 경로 |
| 긴 입력 우회 | 불필요 | `--input-format stream-json`(stdin NDJSON)만 가능, 단 `--output-format stream-json` 강제 | 파서 2벌 필요 |
| 출력 형식 | `--format json` = **NDJSON 이벤트 스트림** | `--output-format json` = **단일 JSON 객체** | 파서 분리 |
| usage(토큰) | 출력에 없음 → `opencode session export` 추가 호출 | 응답 객체에 **인라인 포함** | usage 수집 경로 분리 |
| 모델 id | `provider/model#variant` | 평면 id (`gemini-3.8-flash-low`) + `--effort` 별도 | 검증·표시 규칙 분리 |
| 모델 목록 | `opencode models` (측정 49개, `provider/model`) | `agy models` (id + 표시명) | 목록 표기 분리 |
| 권한 플래그 | `--auto` | 기본이 관대(실측: 무플래그로 파일 생성·셸 실행 성공), `--mode accept-edits|auto|plan`, `--dangerously-skip-permissions` | agy는 "제한"이 기본이 아님 |
| 세션 연속 | `-c/--continue`, `-s/--session`, `--fork` | `--conversation <id>` (응답의 `conversation_id`) | 워커 v1은 둘 다 미사용 |
| 파일 첨부 | `-f/--file` | 없음(워크스페이스 읽기로 대체) | 공통 파라미터에서 제외 |
| 구조화 출력 | 없음 | `--json-schema` | agy 전용 선택 기능 |
| 사고 노출 | `--thinking` | `--effort`(low~max) | 의미가 다름 → 공통화 금지 |

**결론: "공통 파라미터 + 백엔드별 어댑터" 구조가 맞다.** 공통 파라미터만 사용자에게 노출하고, 백엔드 고유 기능은 `--extra` 같은 통과 인자로 둔다.

## 3. 프롬프트 용량 (실측)

| 백엔드 | 상한 | 근거 |
|---|---|---|
| `agy` | 131,071바이트 (약 128KiB, 한글 기준 약 43,000자) | Linux `MAX_ARG_STRLEN`=131,072 실측. 초과 시 `execve` E2BIG |
| `opencode` | stdin 경유로 수 MB 가능 | `message...`가 선택 인자이고 플러그인이 stdin으로 전달 |

agy 상한 초과 시 동작 규칙(제안):
1. 128KiB 초과 → 즉시 명확한 오류 반환(실행하지 않음), 안내 문구에 실제 바이트 수 표시
2. 향후 stream-json 경로로 승격(별도 파서 필요, v1 범위 밖)

## 4. 명령 설계

두 명령 모두 `/<명령> <task>` 형태로 통일한다.

```
/ocode <task>    # OpenCode CLI 워커
/agy   <task>    # Antigravity CLI 워커
```

공통 옵션(둘 다 지원):

| 옵션 | 의미 |
|---|---|
| `--model <id>` | 이번 호출만 모델 오버라이드 |
| `--collect <glob>` (반복) | 산출물 수집 |
| `--timeout <ms>` | 상한 |
| `--json` | 모델 응답 원문(JSON)까지 표시 |

백엔드 고유 옵션(해당 명령에서만):

| 옵션 | 백엔드 | 의미 |
|---|---|---|
| `--effort low|medium|high|xhigh|max` | agy | 사고 강도 |
| `--mode accept-edits|auto|plan` | agy | 실행 모드(plan은 쓰기 차단) |
| `--agent <name>`, `--thinking`, `--file <path>` | opencode | 에이전트·사고노출·첨부 |

옵션 없는 `/agy <task>`는 설정의 기본 모델(`gemini-3.8-flash-low`)을 쓴다.

## 5. 명령 현황 (구현 완료)

| 명령 | 상태 |
|---|---|
| `/agy <task>` | 등록됨 (Antigravity) |
| `/ocode <task>` | 등록됨 (OpenCode) |
| `/opencode`, `/worker` | **삭제됨** |

공통 옵션: `--model`, `--timeout`, `--json`
`/agy` 전용: `--effort`, `--mode`
`/ocode` 전용: `--model`에 `#variant`(추론 레벨) 포함

마지막 선택값은 `$DSH_HOME/cli-worker-selection.json`에 저장되어 다음 호출의 기본값이 된다.

### 추론 표기 차이 (실측)
- `ocode`: `reasoning` 이벤트를 실제 텍스트로 출력 → `--- reasoning ---` 섹션
- `agy`: 추론 **텍스트를 내보내지 않음**. `thinking_tokens` 개수만 제공하므로 "agy reported N thinking tokens but does not emit reasoning text"로 명시

### plan 모드
`/agy --mode plan`은 실패가 아니다. 파일은 반영되지 않지만 계획/응답 전체를 출력하고 `[PLAN_ONLY — 파일 미반영]` 메타데이터를 붙인다.


| 안 | 동작 | 장점 | 비용 |
|---|---|---|---|
| **A. 플래그** | `/agy --model gemini-3.8-flash-high <task>` | 구현 간단, CLI답고 스크립트 가능, 재시작 불필요 | 모델 id를 외워야 함 |
| **B. 목록 먼저** | `/agy` 입력 → 입력창 위 모델 후보 목록 → 선택 → task 입력 | 발견성 최고 | 클라이언트 후보 UI(`ui-input-trigger` 계열) 구현 필요, 작업량 큼 |
| **C. 설정 고정 + 오버라이드** | 기본 모델은 설정, 필요 시 A로 변경 | 설정 UI와 일관 | A와 동일 |

권장: **v1은 A+C**. `--model` 생략 시 설정값, `--model list`(또는 `/agy models`)로 목록 출력.
B는 후속 작업으로 분리(명령·도구 계약이 먼저 안정화되어야 후보 UI를 붙일 수 있음).

## 6. 산출물 표기 (두 명령 공통)

도구 결과 본문은 동일 렌더러를 쓴다.

```
<backend> worker finished successfully.
[tokens: input N, output N, cached N]
[artifacts]
  dist/app.js (12,345 B, sha256 abcdef123456…)
[no match for: build/*.map]
[2 artifact(s) dropped by the collection limit]
[output truncated — tail shown]

<최종 응답 텍스트>
--- stderr ---
<꼬리 4KB>
```

규칙:
- `artifacts[]`는 `path`, `bytes`, `sha256` 고정 3필드
- 매칭 실패 글롭은 `missing[]`로 반드시 보고(조용히 누락 금지)
- 한도 초과분은 개수로 보고
- UI 카드 제목은 `agy_worker`/`cli_worker` 대신 `backend · model`로 표기해 어느 모델이 실행했는지 보이게 한다

## 7. 남은 결정 사항

1. 두 명령을 어디에 둘 것인가: 기존 두 플러그인에 각각 추가 vs 공통 "cli-worker" 플러그인 신설
2. `/agy`의 기본값: 모델 `gemini-3.8-flash-low`, 모드 `accept-edits`(현행 기본과 동일)
3. agy plan 모드 결과를 `ok:false`로 처리할지(현재는 SUCCESS로 오판)
4. 산출물 자동 수집 여부: 기본 미수집(명시적 `--collect`만) vs 기본 워크스페이스 변경 자동 보고
