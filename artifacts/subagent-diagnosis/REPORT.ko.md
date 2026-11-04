# 서브에이전트 실패 진단 — session-e42cf5d8 (2026-11-05)

<!-- skeleton:
version: 1.0
kind: measurement
status: measured
updated: 2026-11-05
summary: session-e42cf5d8의 subagent provider 제약, step-5-preview HTTP 451, opencode v2 끊김, 자식 7개 도구 호출 오류를 세션 로그 114개 + 라이브 프로브로 실측한 진단 보고서.
-->

측정 시각: 2026-11-05 07:49–07:59 KST · 측정자: team lead + provider-analyst + error-analyst
입력: 사용자가 준 `session.v4.jsonl`(= 자식 `b70d93d8` 세션, sha256 일치 확인), 부모 `session-e42cf5d8` 원본(zstd), `~/.dsh/sessions` 114개 로그, 프로필 config, 플러그인 소스, 라이브 subagent 프로브 3회.
읽기 전용 원칙 준수: `~/.dsh`·repo 소스 수정 없음. 산출물만 `artifacts/subagent-diagnosis/`에 기록.

---

## 0. 결론 요약

| 질문 | 실측 판정 |
|---|---|
| "이 세션 subagent provider는 opencode-http-agent 하나뿐" | **그 세션에서는 사실.** 단, 그것은 **등록된 provider 목록이 아니라 세션에 동결된 정책 스냅샷**이다. |
| 딥마인드/안티그래비티 subagent 호출 불가 | **설정 누락이 아니라 세션 생성 시점 스냅샷 때문.** 05:42:45 생성 당시 `allowedModels`가 8개(opencode만)였고, 이후 config가 11개로 늘어도 **기존 세션에는 절대 반영되지 않는다**. 07:41:18 생성된 새 세션은 11개를 받았고, 실제 프로브에서 antigravity 호출 성공. |
| Gemini 3.5 없음 / 기본 gemini-3.8-flash | **절반은 틀렸다.** `gemini-3.5-flash-lite`는 실제 모델이다(2.5 별칭들의 base id). 기본 id는 `gemini-3.8-flash-low`. 라이브 프로브 `PROBE_OK antigravity gemini-3.5-flash-lite`. |
| "hy preview"가 오류로 끊김 | **해당 없음.** `opencode-go/hy4-preview`는 실행된 2회 모두 정상 완료. 실제로 끊긴 것은 **`step-5-preview`** (HTTP 451). |
| 451은 우리쪽 문제인가 | **원인은 upstream OpenCode 엔드포인트 종료**(백엔드 자체 오류 봉투). 단 **재시도 0회·폴백 없음**이라는 DSH 클라이언트 정책이 27스텝 자식을 통째로 죽였다 → 개선 필요. |
| opencode v2 작업중 끊김 | **두 종류.** ① 451(upstream), ② **로컬 opencode 데몬 404 `ProviderNotFoundError`** 3일간 고유 시각 8회. ②는 우리쪽 복원력 문제. |
| 자식 도구 호출 오류 많음 | **504콜 / 63오류 = 12.5%**, 60스텝 낭비. **전부 모델 생성 코드 오류**(파서/하네스 버그 아님). 무료 프리뷰 모델이 16.5–34.8%, 유료 2.7–4.0%. |

---

## 1. 검증 대상

- 부모: `session-e42cf5d8-b927-42fc-814b-6b30a38f9983`, 생성 **05:42:45.900 KST**, cwd `.../dsh-plugins`, preset은 07:20:36에 `ptc`로 선택됨.
- 자식 7개(모두 provider `opencode-http-agent`, preset `ptc` 상속):

| 자식 | 라벨 | 모델 | 턴 결과 |
|---|---|---|---|
| `59429101` | Primary 3-day measurement | deepseek-v4.1-flash | completed |
| `1217d636` | Engine-side cross-check | minimax-m3.1-flash | completed |
| `5b72bfc9` | Cost attribution | deepseek-v4.1-flash | completed |
| `5d17dd9f` | Adversarial audit | beam-free | completed |
| `b70d93d8` | Per-day trend | **step-5-preview** | **error (HTTP 451)** |
| `022a9249` | Per-day trend re-run | iceman-contributor-free | completed |
| `72fa9915` | Adversarial audit re-run | iceman-contributor-free | **in-flight (07:59 현재도 실행 중)** |

- 사용자가 준 첨부 `session.v4.jsonl`은 **`b70d93d8` 자식 세션과 바이트 동일**(sha256 `96e90d1a…`). 즉 "그 세션에서 호출한 서브에이전트" 중 451로 죽은 그 자식의 로그다.
- **live 상태(07:59)**: 부모 `e42cf5d8`은 turn 4/5(07:49/07:53)를 이어가고 있고, 자식 `72fa9915`(iceman, 감사 재실행)는 07:59 현재도 실행 중이다. 이 자식은 46콜 중 16오류(34.8%)를 내며 계속 재시도 중 — 무료 모델 + run_code 표면의 전형적 실패 패턴이며, 결과 수거자가 없는 상태로 남아 있다.

---

## 2. "provider 하나뿐"의 진짜 정체 — 정책 스냅샷

### 측정

- 부모 세션 seq 3 `subagent/model-selection-policy`(05:42:45.912) = **8개 라우트, 전부 `opencode-http-agent`**.
- 부모가 07:25:47에 직접 시도한 provider별 조회 결과:

```
opencode-http-agent : (8개 모델 목록)
deepseek-account    : ERR LLM provider "..." is not allowed for this Session
deepseek-official   : ERR ... not allowed
opencode-go         : ERR ... not allowed
antigravity         : ERR ... not allowed
deepmind            : ERR ... not allowed
```

- `list_subagent_models` 구현(`dsh-tool-subagent/lib/index.js:189-197`): no-arg 목록은 **등록 provider ∩ 세션 정책**, provider 지정 호출은 **등록 조회 전에 정책에서 거부**(`:194-196`). 따라서 위 오류는 "미등록"이 아니라 "이 세션에 미허용"이다.
- 반증: 같은 데몬이 최상위 세션 모델로 `deepseek-account`를 서비스하는데도 목록에는 안 나온다(정책에 없으므로).
- 정책은 `agent/created` 때 config의 `allowedModels`를 **그대로 복사해 1회 append**하고 다시 해석하지 않는다(`model-selection-settings.js:86-101`, append-once `:52-58`).

### 타임라인

| 시각 (KST) | 사실 |
|---|---|
| 05:13:47 | config 백업 시점 `allowedModels` = 8개 opencode 라우트 (05:42 세션 정책과 바이트 일치) |
| **05:42:45.900** | **세션 생성 → 8개 라우트 동결** |
| 06:05:54 | subagent-* 번들 제거 작업 |
| 07:20:36 | UI에서 preset `ptc` 선택 → 이후 자식들이 run_code 전용 표면 상속 |
| (06:05:54 ~ 07:41:18) | config에 deepinfra·antigravity·hy4 라우트 추가 (정확한 분 단위는 파일 원자적 교체로 복원 불가) |
| **07:41:18** | 새 최상위 세션 생성 → **11개 라우트** 수신 |
| 07:47:11 | settings 저장이 patch YAML을 재직렬화(mtime만 갱신, 편집 시점 아님) |

**결론: 기존 세션은 재시작·리로드로도 새 라우트를 받을 수 없다. 새 최상위 세션만 받는다.** 부모 세션은 07:49/07:53에도 turn 4/5를 이어가며 여전히 8개 라우트 정책이다.

---

## 3. Gemini 3.5 / antigravity — 문구 검증

| 주장 | 실측 | 판정 |
|---|---|---|
| "Gemini 3.5는 레지스트리에 없다" | `dsh-antigravity/lib/catalog.js:37-41`: `gemini-2.5-flash-lite/‑flash/‑thinking` → base id **`gemini-3.5-flash-lite`**(effort low/medium/high). 프로필 `allowedModels`에도 명시. 라이브 subagent 프로브 성공. | **틀림** |
| "antigravity 기본값은 gemini-3.8-flash" | `backends.js:16` `DEFAULT_MODEL='gemini-3.8-flash-low'`; picker id는 `gemini-3.8-flash`. | **부분 사실**(기본 id, 카탈로그 전체가 아님) |
| 근거의 결함 | 부모가 07:25:47에 `grep ... | head -5`로 확인 → 알파벳순으로 `catalog.js`가 잘려나감. `provider:"antigravity"` 조회는 정책에서 거부되어 한 번도 성공 못 함. | 측정 오류 |

라이브 프로브(이 세션에서 직접 호출):
- `antigravity / gemini-3.5-flash-lite` → `PROBE_OK` (child `request/header` 확인)
- `deepinfra / deepseek-ai/DeepSeek-V4.1-Flash-1017` → `PROBE_OK`
- `opencode-http-agent / opencode-go/hy4-preview` → `PROBE_OK`

---

## 4. "hy preview"와 451

### hy4-preview는 실패한 적이 없다

- `opencode-go/hy4-preview` = "Hy4 preview", Hy 계열, text-only, ctx 1,024,000 / out 64,000, 유료 프리뷰.
- 전체 114개 로그에서 실행 2회, **둘 다 완료**:
  - `session-a89aa930` 2026-10-31 01:42 수동 전환 → completed, 오류 0
  - `efb38152` 2026-11-05 07:50 프로브 → completed, 오류 0
- `hy4`/`hy3`는 실행 이력 없음. hy* 라우트 실패 0건.
- **step-5-preview로 대체된 것도 아니다.** 부모가 07:27:11.500에 `model: "opencode-go/step-5-preview"`를 명시 디스패치했고, 재실행은 `iceman-contributor-free`를 명시 지정했다.

### 실제 끊김: `b70d93d8` step-5-preview HTTP 451

| seq | 시각 | 내용 |
|---|---|---|
| 256 | 07:30:42.867 | 마지막 정상 tool result (27스텝/34콜/3분33초 정상) |
| 259 | 07:30:44.712 | `OPENCODE_BACKEND_HTTP 451` — 백엔드 자체 봉투: `server_error` / "Upstream request failed: Endpoint is unavailable." |
| 261 | 07:30:44.716 | `turn/end` error |

- **재시도 0회**: `assistant/attempt` 1회, `llm/retry*` 0건. `OPENCODE_BACKEND_HTTP`는 호스트 재시도 허용 코드(`EMPTY_RESPONSE,RATE_LIMIT,SERVER,TIMEOUT,TRANSPORT`)에 없고, 어댑터는 non-2xx에서 즉시 종료한다(`dsh-opencode-v2/lib/http.js:1786-1800`).
- **동시각 다른 모델 정상**: ±10분 내 다른 라우트 실패 0건. 대체 실행 `022a9249`는 07:30:58 시작해 07:38:48 완료.
- **주의**: `opencode-model-verdicts.json`의 `step-5-preview: unavailable`(measuredAt 07:30:44.712)은 **이 451 자체를 observe()한 결과**이지 독립 재측정이 아니다. 이 verdict가 설정 화면에 그대로 노출된다.
- 비용: 28스텝/34콜 폐기 + 재실행 57스텝/56콜 ≈ **중복 56콜 / 7.8분**.

**판정: 원인은 upstream 엔드포인트 종료(451). 우리쪽 요청 생성 버그 아님. 다만 "non-retryable + 폴백 없음 + 부분작업 미보존"은 우리쪽 개선 지점.**

---

## 5. opencode v2 "작업중 끊김" — 3일 실측

| 모델 | 실패 | 내용 | 재시도 |
|---|---|---|---|
| `deepseek-v4.1-flash` | **12** | **3일간 고유 시각 8회 `opencode GET /api/provider/opencode-go → HTTP 404 ProviderNotFoundError`**(로컬 데몬 control plane), 1× fetch failed, 2× 기타 | 0 |
| `iceman-contributor-free` | turn 실패 0, **stream cut 2회** | `TRANSPORT: stream ended before [DONE]` | **5 (복구됨)** |
| `step-5-preview` | 1 | 451 | 0 |
| `deepseek-flash` | turn 실패 0 | TRANSPORT 1 | 1 (복구) |

- 404는 특정 모델이 아니라 **로컬 opencode 데몬의 provider 카탈로그 문제**다. DSH는 state 파일로 데몬에 attach만 하고 provider 존재를 검증하지 않으며, 404에는 재해석/재스폰/재시도를 하지 않는다(`http.js:360-390` — `error.status`가 있으면 즉시 throw). 2026-10-31~11-04에 반복 재발(3일 창 고유 시각 8회, attempt+turn 중복 제외).
- 즉 "오픈코드 v2 특정 모델 끊김"은 ①upstream 451과 ②로컬 데몬 404라는 **서로 다른 두 원인**이 섞인 현상이다.

---

## 6. 자식 도구 호출 오류 — 실측

스냅샷 07:56:55 KST, 자식 7개 합계 **504 툴콜 / 63 루트 오류 = 12.5%**, 오류만 있던 스텝 **60/504 (11.9%)**.

| 자식 | 모델 | 콜 | 오류 | 오류율 |
|---|---|---|---|---|
| 59429101 | deepseek-v4.1-flash | 110 | 3 | 2.7% |
| 1217d636 | minimax-m3.1-flash | 105 | 4 | 3.8% |
| 5b72bfc9 | deepseek-v4.1-flash | 50 | 2 | 4.0% |
| 5d17dd9f | beam-free | 103 | 17 | **16.5%** |
| b70d93d8 | step-5-preview | 34 | 9 | **26.5%** |
| 022a9249 | iceman-contributor-free | 56 | 12 | **21.4%** |
| 72fa9915 | iceman-contributor-free | 46 | 16 | **34.8%** |

분류: **parse 45(71%)**, runtime 8, invalid args 4, unknown tool 3, old_string 2, timeout 1.

- **전부 모델 생성 코드 문제**다. 실패한 `code` 인자는 잘리지 않은 완전한 JSON이고, V8/TS 파서 메시지가 그대로다. `TypeError: 3.7 is not a function`은 DSH 밖 순수 node에서 1:1 재현됨. 출력 토큰도 상한(16,384)과 무관(최대 10,626).
- 대표 원인: 문자열 안에 작은따옴표 중첩(`sed -n '1,80p'`), 셸 명령을 JS 본문에 그대로 붙여넣기, `run_code` 필수 인자(`description`) 누락, `bash`/`write` 직접 호출(run_code 전용 표면 위반).
- 구조적 증폭: 부모가 07:20:36에 preset `ptc`를 선택했고, 자식은 이를 상속한다(`dsh-subagent/lib/index.js:349`). ptc는 **run_code 하나만 직접 호출 가능**하므로 모든 작업이 TypeScript 프로그램 작성이 된다. `tool-subagent`의 `agentPreset`/`allowedAgentPresets`가 프로필에 설정돼 있지 않아 리드가 자식 preset을 바꿀 수 없다.
- 부모 자신도 툴 오류 3건(90콜): `ReferenceError: B is not defined`, 종료된 자식에게 `send_message` → "active teammate not found", `TypeError ... reading 'text'`.

---

## 7. 권고 (우선순위)

1. **안티그래비티/딥인프라를 쓰려면 새 최상위 세션을 시작**한다. 기존 `e42cf5d8`은 정책이 동결되어 있어 어떤 재시작으로도 안 된다. (이 진단 세션은 이미 11개 라우트로 동작, 3개 provider 프로브 성공.)
2. **자식 preset 문제**: `tool-subagent`에 `allowedAgentPresets: [standard,...]`를 두거나, 자식에게 "run_code 본문은 반드시 유효한 JS" 규칙을 더 강하게 주고, 무료 프리뷰 모델은 코드 생성 작업에 쓰지 않는다. 유료 deepseek/minimax는 2.7–4.0%로 실용적.
3. **opencode 451/404 복원력**: `OPENCODE_BACKEND_HTTP`(특히 5xx/451) 재시도, 로컬 데몬 provider 404 시 데몬 재해석/재스폰, 부분 산출물 보존(현재 27스텝 폐기). stale verdict는 재프로브로 갱신.
4. **문서/보고 정정**: "Gemini 3.5 없음"·"기본 gemini-3.8-flash"·"hy preview 실패"는 사실과 다르다. `list_subagent_models` 출력은 레지스트리가 아니라 세션 정책임을 명시.

---

## 8. 증거 위치

- `artifacts/subagent-diagnosis/parent.v4.jsonl`, `child.v4.jsonl` — 원본 zstd 해제본(자식은 첨부와 동일)
- `artifacts/subagent-diagnosis/prov/FINDINGS.md` + `prov/raw/` — provider 정책 스냅샷 근거, 타임라인, 소스 라인
- `artifacts/subagent-diagnosis/errors/FINDINGS.md` + `taxonomy.json` / `child_metrics.json` / `failures.jsonl` — 오류 분류·451·3일 드롭
- 라이브 프로브 자식 세션: `54938eea`(antigravity), `e62712fa`(deepinfra), `efb38152`(hy4-preview)
