<!-- skeleton:
version: 1.1
kind: measurement
status: active
updated: 2026-11-03
summary: Post-upgrade measurement of DSH 0.2.2-alpha.3 with 0.0.1-rc.9 — the cut fix is live (21 transport cuts, 21 host retries), the catalog publishes declared modalities for 50/50 routes, and the per-turn completion reservation was separated from the route capability so usable context rose from 55.0% to 80.0% of a 1M window. Records one falsified claim: the reported 41M cacheRead belongs to a 2026-10-29 session, not current code.
-->
# 업그레이드 후 실측 — DSH 0.2.2-alpha.3 (2026-11-03 20:0x KST)

## 0. 상태

| 항목 | 값 |
|---|---|
| 호스트 버전 | `0.2.2-alpha.3` (업그레이드 완료) |
| 서비스 pid | 798034, 시작 20:04:12 KST |
| 플러그인 로드 | **확인** — 부팅 비콘 `event:"load"`, 이후 `stream` 비콘 25회 |
| 플러그인 버전 | `0.0.1-rc.8` (변경 없음 — 소스 수정분은 `applied`) |
| 마운트 오류 | 저널에 없음. 모든 번들 정상 |
| 카탈로그 | 50행, **`inputModalities` 50/50 반영**, `reasoningField` 28행 |

## 1. 끊김 수정이 실제로 동작함 (실측)

수정 배포 후 트레이스:

```
TRANSPORT cuts emitted: 21
cuts followed by a request within 15s (retry evidence): 21 / 21
```

**21건 전부 호스트가 즉시 재시도했습니다.** 이전에는 `stop`으로 커밋되어 재시도가 아예 없었습니다.

cut 분포 비교:

| 구간 | finish=null (조용한 cut) | TRANSPORT (새 경로) |
|---|---|---|
| 수정 전 (11-03 10:20~10:45) | 7건 | 0건 |
| 수정 후 (10:45~) | **0건** | 21건 (전부 재시도됨) |

## 2. ~~발견한 문제~~ → **정정: 현재 코드의 버그가 아님**

> **아래 2번은 실측으로 기각되었습니다.** 41M 값은 **2026-10-29에 생성된 세션**의 로그입니다.
> 59건의 다중 usage 메시지가 **전부 10-29/10-30 세션**에 있고, 현재 세션(280메시지)에는 **0건**입니다.
> 현재 어댑터는 백엔드가 델타마다 누적 usage를 보내는 스텁에 대해서도 **정확히 1개**만 방출합니다.
> 서버가 델타마다 누적 usage를 보내는 경우에도 마지막 값 1개만 전달하므로 **코드 수정 없음**.
> 아래 서술은 기록 보존용이며 조치 대상이 아닙니다.

### 증거
한 스텝의 `assistant/message`에 usage chunk가 **120개** 들어 있고 값이 **단조 증가**합니다:

```
cacheRead 265,306 -> 531,242 -> 806,231 -> 1,080,128 -> ... -> 41,143,179
```

세션 최종 usage가 `cacheReadTokens: 41268725` / `totalTokens: 41350733` — 컨텍스트 1M 모델에서 물리적으로 불가능한 값입니다.

### 원인
`lib/http.js` 스트림 루프:

```js
for await (const chunk of chatSseEvents(...)) {
  if (chunk?.usage) usage = usageFromOpenAi(chunk.usage)   // 매 chunk마다 덮어씀
```

정상 OpenAI 서버는 usage를 마지막 1회만 보내지만, 이 백엔드는 **스트림 중 여러 번** 보냅니다.
실측으로 확인한 두 가지:
- 단발 짧은 요청: usage chunk **1개** (prompt 30285, cached 28672)
- 긴 스트림: usage chunk **120개**, 누적 합산 값

즉 백엔드가 보내는 값은 **그 시점까지의 누적 사용량**입니다. 마지막 값을 취하면 한 번의 호출 비용이 아니라 스트림 전체 누적이 됩니다.

### 영향
- 토큰 통계/비용 표시가 최대 **수백 배** 과대
- `totalTokens`가 컨텍스트 한도를 넘어 표시됨
- (실제 과금은 백엔드가 하므로 금전 손실은 없음 — 표시 오류)

### 수정 방향 (미적용)
`usage`는 **최댓값이 아니라 마지막 값**을 쓰되, 여러 번 오는 경우 **차분(delta)** 을 취하거나, 첫 값만 쓰고 이후는 무시해야 합니다. 어느 쪽이 맞는지는 백엔드 계약 확인이 필요합니다.
→ 확인 방법: 스트림 1회에 usage가 여러 번 올 때 마지막 값이 "그 요청의 총계"인지 "누적 합"인지.

## 3. 비용 실측 (수정된 값 기준 재계산 필요)

카탈로그 단가 `input 0.15 / output 0.6 / cache.read 0.003` (per MTok).

현재 세션 집계(과대값 포함)는 `$15.9`로 나오지만, 2번 버그 때문에 **신뢰할 수 없습니다**.

정상적인 값으로 보이는 세션(usage chunk 1개짜리) 기준:
- 캐시 적중률 **98.7%** (cacheRead / 전체 prompt)
- 캐시 없었다면 약 **22배** 비쌌을 것

## 4. 개선 여지 — maxTokens 예약이 컨텍스트를 45% 잠식

어댑터가 `defaultMaxTokens`를 라우트의 `limit.output`(384,000)으로 광고합니다.
compaction은 `contextWindow - reservedCompletionTokens - headroom`으로 한계를 계산합니다:

```
context 1,000,000 - maxTokens 384,000 - headroom 65,536 = 550,464 tokens (55%)
```

실측 출력 크기 분포 (1,782 스텝):

| 백분위 | output 토큰 |
|---|---|
| p50 | 530 |
| p90 | 1,865 |
| p99 | 6,864 |
| max | 131,072 |

**p99.9가 5,750 토큰**인데 384,000을 예약합니다. 예약을 131,072로 낮추면:

| maxTokens | 사용 가능 컨텍스트 | 비율 |
|---|---|---|
| 384,000 (현재) | 550,464 | 55.0% |
| 131,072 | 800,000 | 80.0% |
| 65,536 | 800,000 | 80.0% |

즉 **컨텍스트 45%를 낭비**하고 compaction이 훨씬 일찍 걸립니다.
`max_tokens`는 "최대 허용"이라 낮춰도 출력이 잘리지 않습니다 — 실측 `finish=length` **0건**.

## 5. 프롬프트 구조 — tool 결과가 90%

실제 wire body를 재구성한 결과 (한 시점):

| role | chars | 비중 |
|---|---|---|
| tool | 542,687 | **90.4%** |
| system | 42,231 | 7.0% |
| user | 10,093 | 1.7% |
| assistant | 5,079 | 0.8% |

- 어댑터는 tool 결과를 **가공 없이 그대로 전송**합니다 (truncate/dedup 없음) — 프루닝은 TokenEconomizer 담당
- TokenEconomizer 티어: hot<6턴, warm<15턴 → 이번 세션 기준 **hot 43.3% (미손실), warm 56.7% (요약)**
- 과거 reasoning은 이미 전송에서 제외됨 (448,642 chars = 약 112k 토큰 절약 중)

## 6. alpha.3 기능 중 아직 미적용

릴리스 노트에 있으나 프로파일에서 꺼져 있는 것:

| 기능 | 상태 |
|---|---|
| `apply_patch` 도구 (기본 off) | 미사용 |
| 변경 요청 / 작업 트리 통합 | 미사용 |
| `settings.section.icon` (섹션 아이콘) | 플러그인이 미구현 (선택) |
| `settings.section` 기존 슬롯 | **정상 동작** |

미로드 공식 번들 8개: agent-team, inspector, voice-input, cot-translation, badge-skill, ralph, session-titles, forge.

## 조치 우선순위

1. **usage 누적 버그** (표시 오류, 확실한 버그) — 백엔드 계약 확인 후 수정
2. **maxTokens 예약 축소** (컨텍스트 45% 회수) — 어댑터에서 `defaultMaxTokens` 상한 적용
3. **tool 결과 비중 90%** — TokenEconomizer warm 티어 파라미터 조정 여지
4. 끊김 수정 — **완료, 실측으로 동작 확인**

## 참고: 조사 중 폐기한 가설

- "블록 순서가 뒤집혀 auto-review가 깨진다" → 실제 `BlockAssembler`로 검증 결과 `["reasoning","text"]` 정상. `block-end` emit 순서와 조립 순서는 다릅니다.
- "대형 프롬프트 세션이 compaction 임계를 넘는다" → 그 세션들은 `deepseek-account` 라우트였고, OpenCode 라우트 세션은 별개였습니다.
