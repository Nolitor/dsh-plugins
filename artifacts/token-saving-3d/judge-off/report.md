# 루프브레이커 Judge 오버헤드 — 실측과 차단 (A안 적용)

<!-- skeleton:
version: 1.0
kind: measurement
status: applied
updated: 2026-11-05
summary: 3일간 백그라운드 judge 467회/2,280,750 토큰을 실측하고, 2026-11-05 08:12 KST에 gate 임계값을 봉인(A안)해 이후 호출 0회를 확인. 규칙 기반 backstop과 DSH loopBreaker/watchdog는 유지.
-->

대상: `@nolit/dsh-tokeneconomizer`의 엔진 루프가드 (Spiral judge)
적용 시각: **2026-11-05 08:12:19 KST** (epoch 1793833939.670)
측정 창(사전): 2026-11-02 07:24:09 ~ 2026-11-05 07:24:09 KST (3일)

## 1. 조치 내용 (A안)

엔진 설정 파일 **`~/.tokeneconomizer/config.json`** (전역)에 gate 임계값을 pin했다. 별도 judge on/off 스위치가 없으므로, judge를 깨우는 무료 gate를 사실상 닫는 방식이다.

```json
{
  "loopguard_thresholds": {
    "gate_error_outputs": 100000,
    "gate_min_turns": 100000
  }
}
```

적용 명령(실행됨):

```bash
~/.tokeneconomizer/bin/te config set \
  "loopguard.gate_min_turns=100000" \
  "loopguard.gate_error_outputs=100000" --global
```

- `te config` 실효값 확인: 두 값이 100000으로 표시됨.
- 적용 시점: "applies from the next hook call" — 재시작 불필요.
- 우선순위: 내장 → 전역 → 레포(`~/.tokeneconomizer/repos/<repo>/config.json`) → env. 레포 설정에는 gate pin이 없어 전역값이 그대로 적용된다.

## 2. 사전 실측 (3일)

| 항목 | 값 |
|---|---|
| judge 호출 | **467회** |
| judge 토큰 | 2,210,470 |
| nudge writer 토큰 | 70,280 |
| **합계** | **2,280,750 tokens** |
| 호출당 평균 | 4,884 tokens |
| 일평균 | 760,250 tokens |

일별(토큰): 11-02 159,054 · 11-03 651,164 · 11-04 909,680 · 11-05(부분) 560,852
레포별(토큰): dsh-plugins 2,195,652 (96.3%) · project-promotion-manager 77,020 · total-skill 8,078

같은 기간 tiering 직접 절감은 265,589 토큰이므로, **judge 오버헤드가 절감의 8.6배**였다.

## 3. 적용 후 재측정

| 항목 | 값 |
|---|---|
| 신규 `kind:"overhead"` 레코드 | **0건** |
| 신규 judge/writer 토큰 | **0** |
| 변경 이후 갱신된 judge 파일(.request/.result) | **0개** |

측정 방법: 창 내 467건은 `ledger.jsonl`의 `kind:"overhead"` 합계, 적용 후 구간은 `at >= 1793833939.670`인 레코드 전수. judge 파일은 `~/.tokeneconomizer/repos/*/dsh/judge/`의 mtime 비교. 재현: `node measure.mjs --json report.json`.

## 4. 남아 있는 규칙 기반 안전망 (judge 없이 동작)

- **backstop**: `is_stuck`(churn/scatter AND 지속 에러 AND 동일 실패 반복) + `envelope × 2.5`. judge보다 **먼저** 검사되며 nudge → abort 사다리 유지.
- **DSH loopBreaker** (플러그인 로컬): 동일 실패 3회/5콜 → 턴 중단 + 안내 프롬프트.
- **watchdog**: 진행 없는 step/tool 10분 → 중단.

즉 judge(LLM)만 제거되고, 루프 감지의 규칙 기반 계층은 그대로다.

## 5. 트레이드오프 / 주의

- judge가 담당하던 **정밀 판정**(오탐 중단 방지)과 **judge가 작성하던 nudge 문구**는 사라진다. backstop의 nudge는 남는다.
- gate 봉인은 "judge만 끄기" 위한 설정 우회다. 정식으로는 엔진에 `loopguard_judge=off` 설정을 추가해 `judge=None` fallback(`is_stuck` + envelope)을 쓰는 것이 더 깔끔하다(코드 ~15줄, 미적용).
- 엔진 가드 자체를 끄려면 `te config set loopguard=off --global` (judge + nudge + abort 모두 중지).
- rate limit 상수(`JUDGE_BASE_GAP=5`, `JUDGE_MAX_GAP=20`)는 하드코딩이라 설정으로 못 바꾼다.

## 6. 되돌리기

```bash
~/.tokeneconomizer/bin/te config unset loopguard_thresholds --global
```
