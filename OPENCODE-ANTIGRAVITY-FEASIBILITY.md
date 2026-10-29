# OpenCode / Antigravity 서브에이전트·모델서빙 실측 정리
<!-- skeleton:
version: 1.0
kind: measurement
status: measured
updated: 2026-10-29
summary: Feasibility of OpenCode and Antigravity CLI as DSH subagents/models: auth, routes, sandbox limits.
-->


측정일: 2026-10-29 (KST)  
런타임: DSH `0.2.2-alpha.2`, OpenCode CLI `v2.2.0`, Antigravity CLI `agy 1.4.9`

## 요약

| 질문 | 결론 |
|---|---|
| OpenCode에 Claude Code식 subagent 플러그인을 만들 수 있나? | 가능. 단 OpenCode 2.2.0은 native subagent를 이미 지원하므로 plugin은 선택 |
| DSH에 OpenCode CLI 기반 플러그인이 이미 있나? | 있음. `@quonaro/dsh-plugin-opencode`가 가장 직접적 |
| OpenCode v2 공식문서에 대체 기능이 있나? | 있음. Agents/Tools/Commands/Skills/Plugins 문서가 대응 |
| Antigravity CLI 모델 서빙은 동작하나? | `agy` CLI 자체는 정상. ACP 플러그인은 실패 |
| Antigravity subagent 전용 플러그인이 있나? | 있음. `dsh-subagent-antigravity` |

## 1. OpenCode 측 실측

### 1.1 native subagent — plugin 없이 동작

`.opencode/agents/reviewer.md`:

```md
---
description: Markdown-defined reviewer subagent
mode: subagent
model: opencode-go/mimo-v2.6-flash
---
You are a strict code reviewer.
```

- `opencode debug agents`에 `reviewer`, `mode=subagent`로 등록
- 부모 agent가 `subagent` tool로 호출 성공 (`MD_OK`)
- `opencode.json > agents` 방식도 동일하게 동작

### 1.2 plugin으로 동적 등록 — 동작하지만 비공식

OpenCode 2.2.0의 plugin v2 형식:

```js
export default {
  id: "claude-code-subagents",
  async setup(context) {
    await context.agent.transform((draft) => {
      draft.update("reviewer", (agent) => {
        agent.mode = "subagent"
        agent.system = "..."
        agent.model = { providerID: "opencode-go", id: "mimo-v2.6-flash" }
      })
    })
  },
}
```

- `.claude/agents/*.md`를 읽어 등록하는 프로토타입으로 `PROTO_OK` 응답 확인
- **공식 `AgentEditor` 타입에는 `add()`가 없다** (`list/get/default/update/remove`만)
- 새 agent 추가는 `update(newId, ...)`로 동작하지만 타입 보장이 없음
- 운영용은 `.opencode/agents/*.md` 또는 `agents` config가 안전

### 1.3 Claude Code frontmatter 호환성

| 입력 | 결과 |
|---|---|
| `mode: subagent` + `tools: Read` (comma 문자열) | agent 등록 안 됨 (조용히 skip) |
| `mode: subagent` + `model: sonnet` | agent는 등록, model은 무시 |
| `mode: subagent` + `model: provider/model` | 정상 |

→ Claude Code agent Markdown을 그대로 복사하면 안 되고 변환 필요.

## 2. OpenCode v2 공식문서 대체표

| Claude Code 개념 | OpenCode v2 대체 | 문서 |
|---|---|---|
| subagent 정의 | `.opencode/agents/<name>.md` + `mode: subagent` | `/v2/docs/agents/` |
| subagent 실행 | `subagent` tool (`agent`, `description`, `prompt`) | `/v2/docs/tools/` |
| 병렬/백그라운드 | `subagent` + `background: true`, `sessionID` 재개 | `/v2/docs/tools/` |
| subagent 권한 | `permissions` action `subagent` | `/v2/docs/permissions/` |
| plugin package | `plugins` config / `.opencode/plugins/` | `/v2/docs/plugins/` |
| plugin authoring | `Plugin.define({ id, setup })` | `/v2/docs/build/plugins/` |
| slash command | `.opencode/commands/*.md` | `/v2/docs/commands/` |
| skill | `.opencode/skills/...`, `.claude/skills` 호환 | `/v2/docs/skills/` |
| `CLAUDE.md` | `AGENTS.md`만 인식, fallback 없음 | `/v2/docs/instructions/` |
| V1 plugin | V2에서 실행 불가, port 필요 | `/v2/docs/build/plugins/migrate-v1/` |

**기능 대체는 가능, 문서/포맷 1:1 대체는 아님.**

- `.claude/agents` 자동 발견 없음
- `.claude-plugin/plugin.json` 직접 지원 없음
- 공식 `AgentEditor.add()` 없음

## 3. DSH OpenCode CLI 선행 사례

| 패키지 | 방식 | 마켓 등재 |
|---|---|---|
| `@quonaro/dsh-plugin-opencode` | `opencode run --format json` — `opencode` tool + `/opencode` command + `opencode-agent` provider | 없음 |
| `dsh-opencode-cli-bridge` | `opencode run` native `LlmAdapter`, 세션 지속 | 있음 |
| `dsh-opencode-cli` | `opencode serve` + SSE | 없음 |
| `dsh-opencode-connect` | `opencode serve` 카탈로그를 DSH model picker로 | 있음 |
| `dsh-connect-opencode` | `opencode serve` 전체 provider | 있음 |

### 3.1 `@quonaro/dsh-plugin-opencode` 실측 결과

- 격리 프로필 + 라이브 `web` 프로필 모두 설치 성공
- 모델 선택기에 `OpenCode ACP` 그룹 노출
- `opencode-go/mimo-v2.6-flash` 선택 후 실제 응답 성공
- `dsh-web.service` 재시작 후에도 정상 응답 (`POST_RESTART_OPENCODE_OK`)

제약:

- **추론 강도(사고 깊이) 설정 불가** — 플러그인이 `reasoning.efforts`를 선언하지 않고
  `opencode run`에 effort 관련 인자를 넘기지 않음
- `OpenCode (config default)` 항목은 고정 모델이 아니라 OpenCode 자체 설정 기본값
  (현재 `opencode-go/mimo-v2.6-flash`)
- peer dependency warning 있음 (`@deepseek-ai/dsh-*` 누락 표시) — 동작에는 문제 없음

### 3.2 OpenCode v2 호환 문제

다음 3개는 OpenCode v2에서 바로 동작하지 않았다.

| 패키지 | 실패 원인 |
|---|---|
| `dsh-opencode-cli-bridge` | v2에서 `opencode run --dir` 미지원 |
| `dsh-opencode-cli` | v2에서 `opencode serve --pure` 미지원 |
| `dsh-opencode-connect` | v2 `/session`, `/config/providers`가 SPA HTML 반환 |

## 4. Antigravity CLI 실측

### 4.1 `agy models` — 13개

```text
gemini-4-argon-low|medium|high
gemini-3.8-flash-low|medium|high
claude-opus-5-5-low|medium|high
claude-sonnet-5-5-low|medium|high
gpt-oss-120b-medium
```

### 4.2 단일 프롬프트

`gemini-3.8-flash-low`:

```json
{"status":"SUCCESS","response":"2870\n","duration_seconds":2.65,
 "usage":{"input_tokens":10605,"output_tokens":4,"thinking_tokens":0}}
```

`gemini-4-argon --effort medium`:

```json
{"status":"SUCCESS","response":"2870\n","duration_seconds":4.26,
 "usage":{"input_tokens":10437,"output_tokens":79,"thinking_tokens":71}}
```

### 4.3 stream-json

```text
init -> step_update(user_input DONE) -> step_update(agent_response ACTIVE)
 -> step_update(agent_response DONE) -> result
```

`STREAM_OK` 정상 수신.

### 4.4 `/usage`

```text
Gemini Models          weekly 64%   5h 80%
Claude and GPT models  weekly 100%  5h 100%
Gemini 4 Argon         weekly 98%
```

### 4.5 모델 slug + effort 충돌

```text
--model gemini-3.8-flash-low --effort high
-> ERROR: --model ... conflicts with --effort=high
```

→ 모델 선택 축은 하나만: slug에 level 포함 OR base model + `--effort`.

## 5. Antigravity 플러그인 실측

### 5.1 `dsh-bundle-antigravity-host@0.1.30` — 모델 목록 성공, 호출 실패

- 모델 선택기에 `Antigravity (ACP)` 그룹 정상 노출
- `Gemini 4 Argon` 선택 성공
- 실제 호출 실패:

```text
ACP 请求被拒绝 (session/new): Internal error
```

- 원인: 플러그인의 OAuth client 추출이 `agy 1.4.9` 바이너리의 후보 중
  refresh token과 맞지 않는 조합을 골라 HTTP 401 (`invalid_client`)
- 올바른 client로 우회해도 `session/new`에서 `Internal error`
- `agy -p` 자체는 정상 → ACP bridge 경로 문제

### 5.2 `dsh-subagent-antigravity@0.1.0` — CLI subagent 전용

구조:

```text
부모 DSH 세션
  -> subagent_antigravity({ description, prompt })
  -> agy --print --output-format stream-json
  -> 최종 답변만 부모에게 반환
```

- `engines.dsh >=0.2.1-rc.2 <0.3.0-0` → 현재 런타임 범위 일치
- `peerDependencies: null`
- 모델 선택기/OAuth 래핑 없음, 로컬 `agy` CLI만 호출
- 모델/effort는 **플러그인 설정 고정** (호출 인자 아님)
- 기본 `gemini-4-argon-medium`, `skipPermissions: true`, `timeoutMs 15분`

## 6. 정책 참고

- OpenCode Go는 공식 문서에서 Claude Code / Codex / Hermes / Pi / Raycast 등
  외부 도구 사용법을 안내 → 외부 플러그인 사용이 전제된 상품
- Antigravity consumer-plan wrapping은 Google 문서/FAQ에 비지원 문구가 있음
  (Core-02-HUB `OPEN-SOURCE-ADOPTION-MATRIX.md`, `RULE.md` 참조)
- 두 경우 모두 “불법”이 아니라 **ToS/계정 제재 가능성** 문제

## 7. 최종 판단

1. **OpenCode subagent**는 plugin 없이 native `.opencode/agents/*.md`가 안전
2. **Claude Code 호환**은 build-time converter가 runtime adapter보다 안전
3. DSH에서 **OpenCode Go 모델 서빙**은 `@quonaro/dsh-plugin-opencode`가 실사용 가능
   (단 추론 강도 조절은 미지원)
4. **Antigravity 모델 서빙**은 ACP 플러그인이 현재 실패
5. **Antigravity subagent**는 `dsh-subagent-antigravity`가 유일한 1회성 CLI 방식
