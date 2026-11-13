<!-- skeleton:
version: 1.1
kind: measurement
status: superseded
updated: 2026-11-03
summary: Measured cause and fix for two reported defects in 0.0.1-rc.8 — responses ending mid-reasoning (finish_reason absent, reported as a clean stop so the host never retried) and the served-model picker lacking modality/reasoning metadata (inputModalities hardcoded to ["text"], which made dsh-subagent refuse image input). Includes the falsified hypothesis that variant settings could be forwarded to the wire. SUPERSEDED on the usage section — see POST-UPGRADE-MEASUREMENT.md.
-->
# dsh-opencode-v2 — 두 문제 실측 · 조치 (2026-11-03 KST)

> **정정 (2026-11-03 20:4x KST)**: 이 문서 작성 시점에는 없던 `usage` 누적 관련 내용은
> 이후 실측에서 **구버전(2026-10-29 생성 세션) 로그**로 판명됐습니다. 현재 코드는 시도당
> `usage` 청크를 정확히 1개만 냅니다. 자세한 내용은
> [POST-UPGRADE-MEASUREMENT.md](POST-UPGRADE-MEASUREMENT.md) 참조.

## 요약

| 문제 | 원인 (실측) | 조치 | 상태 |
|---|---|---|---|
| 응답이 중간에 끊김 | `finish_reason` 없이 EOF가 오면 `finishFromOpenAi(undefined)`가 **정상 `stop`**으로 보고 → 재시도 경로 미작동 | 종료자(`[DONE]`)·`finish_reason`·실제 출력 3가지를 함께 보고 cut이면 retryable `TRANSPORT`로 보고 | 코드 적용, 테스트 303/303 |
| 모델 모달 옵션 미지원 | 카탈로그의 `capabilities.input` / `compatibility.reasoningField`를 버리고 `inputModalities:['text']` 하드코딩 | 두 필드를 파싱해 `listModels`/`resolveModel`/스트림 리더에 전달 | 코드 적용, 라이브 카탈로그로 확인 |

## 1. 끊김 — 실측 근거

`/tmp/opencode-v2-trace.jsonl` (14,193줄):

| 날짜 | request | finish | finish=null | error |
|---|---|---|---|---|
| 11-01 | 1750 | 1636 | 0 | 102 (전부 `terminated`) |
| 11-02 | 24 | 25 | 0 | 0 |
| 11-03 | 354 | 354 | **6** | 0 |

11-03의 6건은 **전부** 같은 서명 — reasoning 델타만 있고 content/tool-call 0:

```
746949-54  chars 256534  msgs 111  reasoning 4749
746949-62  chars 267392  msgs 126  reasoning 4135
746949-77  chars 295888  msgs 156  reasoning 4275
746949-85  chars 304450  msgs 171  reasoning 1964
746949-91  chars 311000  msgs 182  reasoning  464
746949-95  chars 312677  msgs 189  reasoning  510
```

- 예외가 아니라 **정상 EOF** → catch 블록(재시도/부분보존)을 타지 않음.
- 호스트는 `stop`으로 커밋 → `llm-retry` 리스너는 실패를 보지 못함.
- 세션 로그에도 assistant 메시지가 reasoning 블록만 가진 채 저장됨.

수정 후 동작 (stub 백엔드 실측):

```
reasoning-only, no [DONE]        => error/TRANSPORT  "ended before [DONE]"
reasoning-only, with [DONE]      => error/TRANSPORT  "ended without finish_reason"
text, no finish_reason           => stop            (부분 출력 보존)
normal finish                    => stop
```

`TRANSPORT`는 호스트 기본 재시도 코드(`dsh-llm` DEFAULT_RETRYABLE_CODES)에 포함되어
`llm-retry`가 같은 step을 다시 실행한다.

## 2. 모달 옵션 — 실측 근거

live `GET /api/model` 50개 라우트 중 이미지 입력 가능 20개 이상. 어댑터는 전부 `['text']`로 광고해
`dsh-subagent`가 `MODEL_DOES_NOT_SUPPORT_IMAGES`로 요청을 **보내기도 전에** 거부했다.

수정 후 라이브 카탈로그 실측:
```
rows 31, image rows 21
claude-haiku-5-5  inputModalities ["text","image"]
deepseek-v4.1-flash context 1000000 max 384000 efforts low,high,max  ["text","image"]
gpt-6-luna          context 1050000 max 128000 efforts none..max      ["text","image"]
```

## 기각된 가설 (다시 적용하면 안 됨)

"variant `settings`를 wire body로 전달" — 라이브 백엔드에 카탈로그 그대로 보내 실측한 결과:

| route | keys | 결과 |
|---|---|---|
| gemini-4-argon | thinkingConfig | 503 Endpoint unavailable |
| gpt-6-luna | include, reasoningSummary | **400** cannot be represented |
| claude-haiku-5-5 | thinking, effort | **400** cannot be represented |

`settings`는 OpenCode 내부 provider 옵션이며 OpenAI wire 필드가 아니다.
effort는 기존 경로(`reasoning_effort`)가 맞고, 이 경로는 glm/gemini/claude에서 실제로 유효함을 확인했다.

## 남은 것 (미적용)

- `gpt-6-luna`는 어떤 필드 조합에서도 reasoning 델타를 내지 않음 → 이 라우트는 추론 표시가 원래 없다.
  picker에 level이 보이는데 실제로는 아무 효과가 없는 상태(카탈로그 자체의 주장과 실제가 다름).
- 요청 크기: 오늘 420건 중 118건이 250k chars 초과. 끊긴 6건은 전부 256k~313k 구간이었다.
  재시도로 해결되지만 근본적으로는 compaction 임계값 검토 여지.
- 적용하려면 dsh-web 재시작이 필요(라이브 프로파일이 이 패키지를 link로 물고 있음).
