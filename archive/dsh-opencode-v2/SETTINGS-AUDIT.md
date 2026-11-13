<!-- skeleton:
version: 1.0
kind: measurement
status: active
updated: 2026-11-03
summary: Audit of the two settings surfaces for this plugin — the auto-generated "OpenCode Go (direct)" form (registerConfigurableProviders, 40 volatile fields) and the hand-written "OpenCode V2" section (plan + allow-list + ranking). Confirms both work (allow-list filters, plan gate, ranking 18 models, 12/12 profile routes valid) and finds three defects, the concrete one being password/apiKey missing role('secret'), proven with the host's own redactSecrets().
-->
# 설정 화면 감사 — "OpenCode Go (direct)" 와 "오픈코드 V2" (2026-11-03 20:4x KST)

## 결론 먼저

| 질문 | 실측 답 |
|---|---|
| "OpenCode Go (direct)" 실제로 쓰는거야? | **써. 단, 이름만 그렇고 "폼"이다.** 이건 모델 라우트가 아니라 **설정 자동 생성 폼**이다 |
| 예전 작업하다 방치한거야? | **아니야.** 코드에서 의도적으로 등록한다(`registerConfigurableProviders`) |
| "오픈코드 V2" 제대로 작업한거야? | **기능은 동작한다.** 다만 **중복 UI + 미완성 흔적 2개**가 있다 |
| 어설픈 설정이야? | **부분적으로 맞다.** 아래 3개가 실제 결함 |

---

## 1. "OpenCode Go (direct)"의 정체

`lib/http.js:746`:
```js
providerInfo(provider) {
  return { id: provider, name: 'OpenCode Go (direct)' }
}
```

`lib/http.js:2003`:
```js
directory = ctx.llm.registerConfigurableProviders([
  { provider: providerId, displayName: 'OpenCode Go (direct)', settingsNs: name, settingsPath: [] },
])
```

즉 **모델 제공자(provider) 자체**이고, 이름이 "OpenCode Go (direct)"인 이유는
"OpenCode 서버를 경유하지 않고 `/chat/completions`로 직접"이라는 뜻이다.
세션은 실제로 이걸 쓴다 — 이번 세션 377개 메시지 전부 `opencode-http-agent`.

**그런데 설정에 나타나는 그 항목은 모델 라우트가 아니라 자동 폼이다.**
`settingsNs: name` (= `dsh-opencode-v2-http`)을 넘기므로, DSH 설정 UI가
**그 row의 모든 volatile 필드 40개를 폼으로 렌더링**한다:

```
baseUrl, password, conflictPolicy, attachToDaemon, opencodePath, cwd, defaultModel,
backendBaseUrl, apiKey, credentialLabel, reasoningField, effortField, turnMaxTokens,
timeoutMs, streamRetries, discoveryCacheMs, catalogSyncMs, activePlan, rankingUrl,
enabledModels, ...
```

## 2. 결함 ① — 비밀번호가 평문으로 폼에 노출된다 (호스트 redaction 함수로 증명)

`password`/`apiKey`는 `.volatile()`만 붙었고 **`role('secret')`이 없다.**

DSH의 설정 redaction은 **`role('secret')`만** 지운다 (`dsh-settings/lib/index.js:73,107`).
호스트의 실제 `redactSecrets()`를 우리 스키마에 그대로 돌린 결과:

```
=== CURRENT plugin schema ===
secrets declared: 0
password after redaction: "SUPER-SECRET-PW"     ← 평문 그대로
apiKey after redaction  : "oc_sk_SECRET_KEY"    ← 평문 그대로

=== WITH role("secret") ===
secrets declared: 2
password after redaction: undefined             ← 제거됨
apiKey after redaction  : undefined             ← 제거됨
non-secret preserved    : 16384
```

선례: `dsh-deepseek-account-platform`은 `Schema.dict(Schema.string().role("secret"))`를 쓴다.
우리 플러그인은 `grep -c 'role(' lib/http.js lib/provider.js` → **0, 0**.

**영향**: "OpenCode Go (direct)" 폼에서 `password` 필드에 로컬 OpenCode 서버 비밀번호가
평문으로 보인다. 이건 `~/.local/state/opencode/service.json`의 값이다.
→ `role('secret')` 추가로 해결(위 실측대로 제거됨).

브라우저까지 도달하는 경로도 확인했다. `dsh-api-settings-controller`는 원격 읽기에
`redactSecrets: true`를 쓰므로, **`role('secret')`인 필드만 응답에서 빠진다**:

```
* Every remote read uses `redactSecrets: true`, so a `role('secret')` field cannot
* ride a response.
```

우리 `password`는 그 표시가 없으므로 **응답에 실려 브라우저 폼까지 간다.**

**단, 현재 위험도는 낮다** — 실측상 라이브 프로파일은 이 필드를 설정하지 않는다:

```
grep 'password|apiKey|credentialLabel|backendBaseUrl' ~/.dsh/profiles/web/cordis.patch.yml
→ (not set)
```

기본값이 `''`이므로 지금 폼에는 **빈 칸**이 보인다. 서버 비밀번호는
`~/.local/state/opencode/service.json`에서 런타임에 읽어 쓰고 설정값을 비워 둔다.

그래서 이 결함은 **"현재 유출"이 아니라 "누가 이 폼에 값을 입력하는 순간 평문 저장·평문 표시"**다.
운영자가 `apiKey`나 `password`를 여기 넣는 것이 자연스러운 동작이므로 고쳐야 한다.

## 3. 결함 ② — 같은 row를 두 UI에서 서로 다르게 편집한다

| UI | 경로 | 편집 대상 |
|---|---|---|
| "OpenCode Go (direct)" | `registerConfigurableProviders` | volatile 필드 **40개 전부** (자동 폼) |
| "오픈코드 V2" | `settings.section` (`lib/client.js`) | `activePlan`, `enabledModels` + 랭킹/배지 |

둘 다 `dsh-opencode-v2-http` row를 고친다. 사용자 입장에서는 **같은 설정이 두 곳**이고,
한쪽에서 저장한 값이 다른 쪽 UI에 즉시 반영되지 않는다
(폼은 `describe()` 시점 스냅샷을 유지).

## 4. 결함 ③ — 문서에 있는데 구현되지 않은 라우트

`lib/http.js:2095` 주석:
```
 * 'model-settings/measure' runs the entitlement sweep; 'model-settings/apply'
```

실제 등록된 라우트 (실측):
```
model-settings, model-settings/ranking/refresh, model-settings/apply
```
→ **measure는 없다.** 문서만 남아 있다.

`lib/http.js:973`에는 반대로 "probe routine은 의도적으로 없다"고 되어 있다.
즉 **설계는 바뀌었는데 주석 한 곳이 갱신되지 않았다.**

영향: 설정 화면에 "인증 오류 / 권한 없음 / 지원 중단 / 사용 불가" 배지가 정의돼 있지만
(`stateAuth`, `stateForbidden`, `stateDeprecated`, `stateUnavailable`),
이 상태들은 **실제 대화 중 백엔드가 거부할 때만** 기록된다(`observe()`).
measure를 누를 방법이 없으므로 **미리 확인할 수단이 없다.**

## 5. 정상 동작하는 것 (실측 확인)

| 항목 | 실측 결과 |
|---|---|
| 라우트 등록 | 3개 정상 (`model-settings`, `ranking/refresh`, `apply`) |
| 카탈로그 | 50행 (go 30 / zen 20) |
| apply 검증 | 잘못된 플랜 → 400 `activePlan must be one of go, zen` |
| allow-list 저장 | `settings.update('dsh-opencode-v2-http', {...})` 정상 호출 |
| allow-list 필터 | 2개 지정 → picker 3행(default+2), **정확히 동작** |
| 플랜 필터 | zen 선택 → go 라우트 0개, zen 20개 |
| 사용량 랭킹 | `opencode.ai/data/index.json` 18개 모델 수신, 13행에 rank 부여 |
| 프로파일 allow-list 12개 | **전부 유효** (stale 없음) |
| subagent allowedModels 8개 | **전부 유효** |
| i18n | ko/en 완비 |

## 6. 정리 — 손볼 것

| # | 결함 | 심각도 | 조치 |
|---|---|---|---|
| 1 | `password`/`apiKey`에 `role('secret')` 없음 | **중간** (현재 빈 값, 입력 시 평문) | `role('secret')` 추가 — 호스트 redaction 실측으로 검증됨 |
| 2 | 설정 UI 중복 (40필드 폼 ↔ 커스텀 섹션) | 중간 | 폼에서 숨기거나 커스텀 섹션으로 일원화 |
| 3 | `model-settings/measure` 미구현 주석 | 낮음 | 주석 정정 또는 라우트 구현 |
| 4 | refusal 배지를 미리 볼 수단 없음 | 낮음 | 3번과 같은 문제 |

### 조치 1의 정확한 검증 (호스트 함수 실측)

```
CURRENT  : secrets declared 0 | password "SUPER-SECRET-PW" 그대로 통과
role()   : secrets declared 2 | password/apiKey 제거, turnMaxTokens 16384 보존
```

**"방치된 것"은 아니다.** 코드·라우트·필터·랭킹 모두 의도대로 동작한다.
다만 **설정 표면이 두 개로 갈라진 채 마무리됐고**, 그중 자동 폼이 비밀번호를 평문 노출한다.
