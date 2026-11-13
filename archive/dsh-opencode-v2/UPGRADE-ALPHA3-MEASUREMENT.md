<!-- skeleton:
version: 1.0
kind: measurement
status: active
updated: 2026-11-03
summary: Pre-upgrade measurement of DSH 0.2.2-alpha.2 to 0.2.2-alpha.3 — installed the release into an isolated prefix, mounted @nolit/dsh-opencode-v2 against the alpha.3 host, registered its adapter into the alpha.3 LlmRuntime, listed the live catalog and streamed a real model. Verdict: no upgrade blocker; the only new obligation is that alpha.3 auto-review sends purpose/sessionId, which the adapter satisfies.
-->
# DSH 업그레이드 실측 — 0.2.2-alpha.2 → 0.2.2-alpha.3 (2026-11-03 KST)

## 결론

**오픈코드 v2 플러그인 때문에 업그레이드가 막히는 요소는 없습니다.** 실측으로 마운트·카탈로그·스트리밍까지 확인했습니다.

| 항목 | 결과 |
|---|---|
| 최신 버전 | `dsh-v0.2.2-alpha.3` (2026-11-03T07:56:48Z), npm `alpha` 태그 |
| 현재 설치 | `0.2.2-alpha.2` |
| alpha.3 마운트 | **성공** (`--dump-config` + 실제 부팅, 부하 비콘 `event:"load"` 기록) |
| alpha.3 LLM 런타임 등록 | **성공** — `providers: ["opencode-http-agent"]` |
| alpha.3 카탈로그 | **성공** — 31행, `["text","image"]`, efforts `low/high/max` |
| alpha.3 실제 스트리밍 | **성공** — 18청크, blocks `["reasoning","text"]`, `finish: stop`, usage 정상 |

## 왜 안전한가 — 의존하는 호스트 표면 실측

플러그인이 실제로 쓰는 호스트 API는 다음뿐입니다:

```
import Schema from '@deepseek-ai/schemastery'          (3.18.6-alpha.1 → alpha.2)
await import('@deepseek-ai/dsh-llm')                   (attributionHeaders 만 사용)
await import('@deepseek-ai/dsh-tools')                 (defineTool 만 사용)
ctx.effect / ctx.inject / ctx.on / ctx.emit / ctx.settings
ctx.llm.registerAdapter / listModels / resolveModelInfo / stream
ctx.subprocess.resolveExecutable
ctx.connection / ctx.slots / ctx.locale
```

alpha.3에서의 실제 변화:

| 패키지 | 변화 | 플러그인 영향 |
|---|---|---|
| `dsh-llm` | `GenerateOptions.purpose`가 `'compaction' \| 'session-title'` → 선언형 `LlmRequestPurpose`로 일반화 | **없음** — 플러그인은 `options.purpose`를 읽기만 함 |
| `dsh-llm` | `LlmAdapter`·`registerAdapter`·retry 규약 | 런타임 diff **0줄**, 완전 동일 |
| `dsh-tools` | `defineTool` 구현 | 런타임 diff **0줄**, 완전 동일 |
| `dsh-subprocess` | `resolveExecutable` | 런타임 diff **0줄**, 완전 동일 |
| `schemastery` | `lib/` 트리 | **바이트 동일** (package.json 버전 문자열만 다름) |
| `cordis` | Fiber 내부 구조 개편(`_config`→`effectiveConfig` 등) | **없음** — 플러그인은 `rawConfig`/`effectiveConfig`/`fiber.store` 미사용 |
| `dsh-client-ui-settings` | `settings.section.icon` 슬롯 **추가**(선택적) | **없음** — 플러그인은 `settings.section`만 사용, 기존 슬롯 유지 |
| `dsh-client-locale` | 변화 없음 | 없음 |

peer 범위도 모두 만족합니다: `^0.2.2-alpha.2` ⊃ `0.2.2-alpha.3`, `engines.dsh >=0.2.2-alpha.2 <0.3.0` ⊃ alpha.3.

## 업그레이드 시 실제로 손봐야 할 것 (플러그인 외)

1. **`@deepseek-ai/dsh-cua-bundle` 제거됨** — 호스트 의존성에서 빠졌습니다. 현재 프로파일 번들 13개에는 없으므로 영향 없음.
2. **`@deepseek-ai/dsh-experimental-tool-worktree`** — 릴리스 노트상 "변경 요청과 작업 트리"로 통합. 프로파일에 없으므로 영향 없음.
3. **plugin 프로파일 재설치 필요** — `dsh` 전역 설치를 올리면 호스트 패키지 경로가 바뀌므로 profile의 번들 해석이 갱신되어야 합니다.

## 업그레이드 후 확인해야 할 유일한 항목

alpha.3의 **자동 검토(auto-review)** 가 OpenCode 라우트로 요청할 때 `purpose: "auto-review"` + `sessionId`를 보냅니다(alpha.2에는 없던 필드). 실측 결과:

```
ASSEMBLED (stream order): ["reasoning","text"]
alpha.3 auto-review assertion passes: true
decision text: "{\"decision\":\"allow\"}"
```

즉 auto-review가 요구하는 "reasoning 블록들 + 정확히 하나의 text 블록" 순서를 어댑터가 만족합니다.
(참고: 릴리스 노트의 "OpenCode 라우트에서 자동 검토가 도구 실행 전 실패" 수정은 이 `sessionId`/`purpose` 전달이 원인이었습니다.)

## 업그레이드 명령 (미실행)

```bash
npm install -g @deepseek-ai/dsh@0.2.2-alpha.3
# 프로파일 번들 재설치
dsh plugin --profile web install
systemctl --user restart dsh-web.service
```

**주의**: `latest` 태그는 `0.2.1-rc.5`이고 alpha.3는 `alpha` 태그입니다. 실수로 `@latest`를 설치하면 **다운그레이드**됩니다(현재 alpha.2 < rc.5 계열 아님, 서로 다른 계열).
