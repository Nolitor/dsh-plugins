# CLI 워커 공통 규격 (/ocode, /agy)

<!-- skeleton:
version: 1.0
kind: spec
status: reference
updated: 2026-10-30
summary: Shared and per-CLI worker contract for the OpenCode (/ocode) and Antigravity (/agy) delegation tools.
-->


OpenCode CLI와 Antigravity CLI(`agy`)를 같은 사용자 경험으로 호출하기 위한 규격.
아래 "실측" 표시는 이 저장소에서 직접 실행해 확인한 값이다.

## 1. 두 CLI의 공통 표준

| 항목 | 공통 규격 |
|---|---|
| 실행 형태 | 1회성 headless 호출. 호출마다 프로세스 1개 |
| 작업 디렉터리 | 자식 프로세스의 cwd = 요청한 작업 디렉터리 |
| 모델 지정 | `--model <id>` 로 1회 오버라이드, 미지정 시 플러그인 기본값 |
| 출력 | stdout = 최종 응답(+ 사용량), stderr = 진단 |
| 종료 코드 | `0` = 성공, 그 외 = 실패. 실패는 stderr tail과 함께 보고 |
| 취소 | 호출자 signal → 프로세스 종료 |
| 자격 증명 | 각 CLI의 기존 인증을 그대로 사용. 플러그인은 자격 증명을 다루지 않음 |
| 대화 격리 | 자식은 부모 대화를 보지 못함. 작업 텍스트만 전달 |

## 2. 호환되지 않는 개별 규격 (실측)

| 항목 | OpenCode (`opencode run`) | Antigravity (`agy -p`) |
|---|---|---|
| 프롬프트 전달 | 메시지 인자 **또는 stdin** (인자 선택) | **argv 전용**. `-p <문자열>` |
| stdin 프롬프트 | 지원 | **미지원** (실측: `-p -` 는 파이프를 무시하고 빈 프롬프트로 진행) |
| 긴 프롬프트 상한 | stdin 경로는 사실상 무제한(수 MB) | **단일 argv 131,072바이트**(Linux `MAX_ARG_STRLEN`). 실측: 131,000 OK / 140,000 `Argument list too long` |
| 긴 프롬프트 우회 | 불필요 | `--input-format stream-json`(stdin NDJSON) + `--output-format stream-json` |
| 출력 형식 | `--format json` = **NDJSON 이벤트 스트림** | **단일 JSON 객체** |
| 사용량(usage) | 별도 `session export` 호출로 집계 | 응답 JSON에 **인라인** 포함 |
| 모델 id 형식 | `provider/model#variant` | 평면 id (`gemini-3.8-flash-low`) + `--effort` 별도 |
| 모델 목록 | `opencode models` | `agy models` (id + 표시명) |
| 권한/승인 | `--auto` | 기본 관대(실측: 무플래그로 파일 쓰기·셸 실행 성공), `--mode`, `--dangerously-skip-permissions` |
| 계획 모드 | 해당 없음 | `--mode plan` — 쓰기를 막지만 **`status: SUCCESS`로 반환**(실측) |
| 세션 재개 | `-s/--session`, `--continue`, `--fork` | `--conversation <id>` (응답의 `conversation_id`) |
| 파일 첨부 | `-f <path>` | 해당 없음 |
| 구조화 출력 | 해당 없음 | `--json-schema <schema>` |

### 결론
두 CLI는 "1회성 headless 호출"이라는 상위 규격만 공유하고, **프롬프트 전달·출력 형식·사용량·모델 표기**는 완전히 다르다. 따라서 공통 계층은 (a) 명령 인터페이스, (b) 산출물 표기, (c) 오류 표기 세 가지로 한정하고, CLI별 차이는 각 백엔드 어댑터가 흡수한다.

## 3. 명령 규격

```
/ocode [옵션] <task>
/agy   [옵션] <task>
```

공통 옵션 (두 명령 동일):

| 옵션 | 의미 | 비고 |
|---|---|---|
| `--model <id>` | 이번 호출의 모델 | 미지정 시 플러그인 기본값 |
| `--timeout <ms>` | 강제 상한 | 기본 600000 |
| `--collect <glob>` (반복) | 산출물 수집 패턴 | cwd 기준 상대 경로 |
| `--json` | 결과를 JSON으로 출력 | 스크립트용 |

`/agy` 전용:

| 옵션 | 의미 |
|---|---|
| `--effort <low\|medium\|high\|xhigh\|max>` | 추론 강도 |
| `--mode <accept-edits\|auto\|plan>` | 실행 모드. `plan`은 작업을 수행하지 않으므로 성공으로 보고하지 않는다 |

`/ocode` 전용:

| 옵션 | 의미 |
|---|---|
| `--agent <name>` | opencode 에이전트 |
| `--auto` | 승인 자동화 |

모델 목록 조회:

```
/agy models      # agy models 결과를 id + 표시명으로 출력
/ocode models    # opencode models 결과 출력
```

## 4. 프롬프트 길이 처리

| 백엔드 | 실질 상한 | 초과 시 동작 |
|---|---|---|
| `/ocode` | stdin 전달이므로 사실상 수 MB | 상한 없음. 메모리 상한만 적용 |
| `/agy` | 약 128 KiB (argv) | **명확히 거부**하고 `--collect` 로 파일에 담아 경로만 전달하도록 안내. stream-json 경로는 v2 과제 |

작업 텍스트 자체가 긴 경우(예: 코드 전문) 공통 권고: 파일로 저장한 뒤 경로를 작업 텍스트에 넣는다. 두 CLI 모두 cwd의 파일을 읽을 수 있으므로 백엔드 차이를 없앨 수 있다.

## 5. 산출물 표기 (공통)

두 명령이 같은 형식으로 보고한다.

```
[artifacts]
path/to/file (12,345 B, sha256 1a2b3c4d5e6f…)
[no match for: dist/**/*.map]
[3 artifact(s) dropped by the collection limit]
[output truncated — tail shown]
```

규칙:
- 경로는 cwd 기준 상대 경로
- 크기와 sha256 앞 12자리 표기
- 매칭 없는 glob은 `missing`으로 보고(조용히 버리지 않음)
- 수집 상한 초과분은 개수로 보고
- 결과 카드 제목은 `<backend> · <model>` (예: `agy · gemini-3.8-flash-low`)

## 6. 모델 선택 UX — 선택지

**A안 (권장, CLI 방식)**
`/agy <task>` 는 설정된 기본 모델로 즉시 실행. 1회 변경은 `--model` 또는 `--effort`. 목록은 `/agy models`.
- 장점: 구현 즉시 가능, 재시작 최소, 자동화·스크립트 친화
- 단점: 모델을 모르면 목록을 먼저 조회해야 함

**B안 (입력창 위 모델 리스트)**
`/agy` 입력 시 client-side 후보 목록(`ui-input-trigger`)을 띄우고 모델 선택 → 이어서 task 입력.
- 장점: 발견성 최고
- 단점: client 플러그인 작업 필요, 서버 재시작·UI 스냅샷 갱신 필요, 두 명령에 중복 구현

**C안 (설정 기본값 + A 혼합)**
플러그인 config에 `model`, `effort`를 두고 GUI 설정에서 변경 가능하게 한 뒤, 명령에서는 오버라이드만 허용.
- 장점: 반복 작업에서 타이핑 최소, A와 동시 적용 가능

권장: **A + C 동시 적용**, B는 별도 후속(client 작업).

## 7. 남은 결정 사항

1. `/ocode` 를 `dsh-opencode-v2` 의 `cli_worker` 옆에 추가할지, `cli_worker`를 대체할지
2. 산출물을 기본 수집할지(자동) 또는 `--collect` 명시 시에만 수집할지
3. `/agy` 의 `plan` 모드 노출 여부 (노출 시 "작업 미수행"을 실패로 보고)
