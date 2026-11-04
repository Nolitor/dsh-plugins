# 토큰절감기(TokenEconomizer) 지난 3일 실측 보고서

<!-- skeleton:
version: 1.1
kind: measurement
status: measured
updated: 2026-11-05
summary: 2026-11-02 07:24 ~ 11-05 07:24 KST 3일 창의 TokenEconomizer 실측. tiering 229건/982,680 chars 순절감(자기팽창 0) + dedup 4건/3,767 chars = 직접 986,447 chars(266,607 tokens). 후속 요청 재전송 누적 47,050,795 tokens(창 prompt의 3.99%, counterfactual delta 3.84%). cold 0·microskills 0·toolprune 미적용. 하네스 프루너 혼입 0. 두 저장소 경로 교차검증 0.00% 불일치. 단 같은 기간 루프브레이커 judge+writer 오버헤드 2,280,750 tokens로 직접 절감(265,589)의 8.6배 — 직접 기준 순효과는 −2,015,161 tokens.
-->

측정 창: **2026-11-02 07:24:09 ~ 2026-11-05 07:24:09 KST** (3일)
측정 주체: 리드 + 서브에이전트 트랙 A(정밀)·B(엔진측)·C(비용)·E(추이), D(적대감사)는 무료 모델 2회 실패 후 리드가 감사 항목 직접 확인
측정 원칙: 원본 툴 결과는 `surfaceOp {op:'replace', startSeq, endSeq}` + `sourceEventSeqs`로 되짚어 **문자 수를 직접 계측**. 추정치와 실측치를 구분하고, 모든 수치는 재현 스크립트로 남김.

## 1. 결론

| 지표 | 값 |
|---|---|
| tiering 재작성 | **229건** (warm 229 / cold 0) |
| charsBefore → charsAfter | **1,668,821 → 686,141** |
| **tiering 순절감** | **982,680 chars = 265,589 tokens** |
| dedup 포인터 | 4건 · 4,100 chars 대체 → **3,767 chars** |
| **직접 절감 합계** | **986,447 chars = 266,607 tokens** |
| 자기팽창(inflating) | **0건** (구 1,200 floor 시대 52.95%에서 소멸) |
| 창 전체 prompt 토큰 | 1,178,681,003 (cache-read 98.88%) |
| **재전송 누적 절감(상한)** | **47,050,795 tokens = 창 prompt의 3.99%** (counterfactual delta 3.84%) |
| 절감 발생 세션 | 8개 (전체 요청 4,934건 중 장기 세션 집중) |
| 엔진 오버헤드(judge+writer) | **2,280,750 tokens** (judge 467회) |
| **직접 기준 순효과** | **−2,015,161 tokens (마이너스)** |

**한 줄**: 3일 동안 오래된 대형 툴 출력 229건을 구조 요약으로 바꿔 **982,680자(약 26.6만 토큰)를 컨텍스트에서 직접 제거**했고, 이 감소가 이후 요청에 재전송되지 않게 한 누적 효과는 **약 4,705만 prompt 토큰(창 전체의 3.99%)**이다. 절감은 사실상 전부 warm tiering에서 나왔고 자기팽창은 0이다. **단, 같은 기간 루프브레이커 judge 오버헤드 2,280,750 토큰이 발생해 직접 토큰 기준 순효과는 −2,015,161 토큰이다** (6절).

## 2. 일별 추이 (KST 달력일, 11-05는 07:24까지 부분일)

| 일자 | 재작성 | net chars | 순토큰 | 자기팽창 | 건당 평균 절감 |
|---|---|---|---|---|---|
| 11-02 | 30 | 187,387 | 50,645 | 0 | 6,246 chars |
| 11-03 | 78 | 239,625 | 64,764 | 0 | 3,072 chars |
| 11-04 | 67 | 304,402 | 82,271 | 0 | 4,543 chars |
| 11-05 (7h24m) | 54 | 251,266 | 67,910 | 0 | 4,653 chars |
| **합계** | **229** | **982,680** | **265,589** | **0** | **4,292 chars** |

- 건수는 11-03(78) 정점 후 감소했지만 **일일 순절감은 187k → 240k → 304k로 증가**했다. 11-05는 7.4시간에 251k(같은 속도면 하루 약 800k).
- 이유: floor 3,700이 작은 입력을 걸러 **건수는 줄고, 남은 큰 입력에서 더 많이 줄어드는** 구조. 재작성당 평균 4,292 chars(원문 7,288 → 2,996, 59% 축소).

일별 엔진 오버헤드와 순효과(토큰):

| 일자 | tiering 절감 | judge+writer | 순효과 |
|---|---|---|---|
| 11-02 | 50,645 | 159,054 | −108,409 |
| 11-03 | 64,764 | 651,164 | −586,400 |
| 11-04 | 82,271 | 909,680 | −827,409 |
| 11-05 | 67,910 | 560,852 | −492,942 |

## 3. 어떻게 절감되는가

| 레버 | 정책/상태 | 창 내 실측 |
|---|---|---|
| hot (최근 6턴) | 원본 유지 | 재작성 0 |
| warm (6~14턴) | 구조 요약(헤드 2,000 + 테일 600 + 인덱스) | **229건, 절감의 100%** |
| cold (15턴+) | 포인터만 | **0건** — 세션 턴 나이가 6~11에 머묾(warmTurns 15 미도달) |
| dedup | 중복 출력 → 포인터 | 4건/3,767 chars (surfaceOp은 append) |
| toolprune | 미사용 도구 마스크 | 제안 5개(11-03 생성)이나 이 라우트 visible 도구는 run_code뿐 → **미적용(untool_applied 전부 빈 값)** |
| microskills | 학습 사실 주입 | **0 chars** (전체 엔진 코퍼스 1,101 레코드에서 0) |
| loop guard | 넛지·중단 | 누적 넛지 12 · abort 2 (창 귀속 불명) |

입력 분포: min 3,719 / p50 5,355 / p90 12,726 / max 49,931 chars. **창 내 3,700 미만 재작성 0건**(floor는 창 시작 전부터 적용). 마지막 3,700 미만 재작성은 2026-11-01 03:50Z.

정책 era(실측): 11-02 08:17~08:34의 18건은 **age 5턴**(5턴 핫윈도 시대, 81,483 chars 절감), 11-02 08:46 이후 211건은 **age 6턴**(6턴 핫윈도, 901,197 chars). 11-02 08:42 커밋(5fba56a) + 재시작과 일치. 총계에는 영향 없음(8.3% vs 91.7%).

## 4. 절감이 집중된 세션 (8개)

| 세션 | 재작성 | net chars | 창 내 요청 | 창 내 prompt |
|---|---|---|---|---|
| session-c67cb8aa | 43 | 236,189 | 609 | 146,514,855 |
| session-4974cafa | 30 | 183,458 | 525 | 147,129,377 |
| session-13a47456 | 38 | 140,491 | 545 | 140,121,665 |
| session-edeabe91 | 25 | 121,082 | 285 | 58,842,798 |
| session-70ee2d8d | 40 | 99,134 | 626 | 175,464,425 |
| session-eaa3d2b7 | 24 | 68,213 | 592 | 161,667,982 |
| session-ca389eef | 24 | 67,808 | 511 | 121,726,623 |
| session-c889802e | 5 | 66,305 | 18 | 1,351,213 |

7개가 요청 500~626건의 장기 에이전트 세션이다. **절감은 "긴 세션의 오래된 대형 툴 출력"에서만 나온다.**

## 5. 두 절감 렌즈 (혼동 금지)

1. **직접 제거(edit basis)**: 986,447 chars ÷ 3.7 = **266,607 tokens** — 컨텍스트에서 실제로 지운 양(창 prompt의 0.023%).
2. **재전송 회피(re-send basis, 상한)**: 재작성 이후 같은 세션의 assistant 요청 수를 곱해 **47,050,795 tokens = 3.99%**(tiering 46,556,062 + dedup 494,733). 창 prompt의 98.88%가 cache-read이므로 **금액 절감은 1:1이 아니며 이 값은 상한**이다.

가격이 확인된 라우트는 deepinfra V4.1-Flash-1017 하나(창 prompt의 10.33%)뿐: input $0.098/1M, cacheRead $0.00294/1M, output $0.294/1M. 그 라우트에서 회피된 4,396,698 tokens의 가치는 **$0.0129(cache 기준) ~ $0.431(비캐시 상한)**. 나머지 라우트(opencode-go, deepseek-account)는 가격표가 없어 토큰으로만 보고한다. 참고로 창 전체 트래픽을 deepinfra 단가로 환산하면 실제 $5.790 vs 반사실 $5.978 → **$0.188(3.25%) 상한**(트랙 A 교차계산).

## 6. 엔진 오버헤드 — tiering 절감을 초과한다 (중요)

| 항목 | 값 |
|---|---|
| 루프브레이커 judge 호출 | **467회** (3일) |
| judge 토큰 | 2,210,470 |
| nudge writer 토큰 | 70,280 |
| **엔진 오버헤드 합계** | **2,280,750 tokens** |
| tiering 직접 절감 | 265,589 tokens |
| **직접 기준 순효과** | **−2,015,161 tokens (8.6배 마이너스)** |

- 출처: `~/.tokeneconomizer/repos/*/dsh/ledger.jsonl`의 `kind:"overhead"` 레코드(창 내 467건)의 `spiral_judge_tokens` + `spiral_nudge_writer_tokens`. 리드가 재계산해 트랙 A와 일치.
- judge 호출당 평균 약 4,733 tokens. 세션 컨텍스트 절감분과 별개로 엔진이 추가로 쓰는 토큰이다.
- 재전송 렌즈(47.05M)와 비교하면 +44.76M으로 보이지만, 그 47M은 98.9%가 cache-read(단가 1/33)이고 judge 토큰은 비캐시 입력에 가깝다. deepinfra 단가로 환산하면 오버헤드 약 $0.22 vs cache-read 절감 약 $0.14 → **단가 기준으로도 순마이너스(추정)**.
- 해석: tiering 자체는 정상 작동(팽창 0, 26.6만 토큰 제거)하지만, 같은 기간 루프브레이커가 그 8.6배를 썼다. "절감기 전체"의 토큰 수지는 직접 기준 마이너스다.

### 6.1 2026-11-05 08:12 KST — A안 적용: gate 봉인으로 judge 차단

`~/.tokeneconomizer/config.json`(전역)에 `loopguard_thresholds = {gate_min_turns: 100000, gate_error_outputs: 100000}`을 pin했다. judge 전용 스위치가 없어 무료 gate를 닫는 방식이며, 다음 훅 호출부터 적용된다(재시작 불필요).

| 구간 | judge 호출 | judge+writer 토큰 |
|---|---|---|
| 적용 전 3일 | 467 | 2,280,750 |
| 적용 후 재측정 | **0** | **0** |

남은 안전망은 규칙 기반뿐이다: 엔진 backstop(is_stuck + envelope×2.5, judge보다 먼저 검사), DSH loopBreaker(동일 실패 3회/5콜), watchdog(무진행 10분). 상세: [judge-off/report.md](judge-off/report.md).

## 7. 교차검증

| 트랙 | 모델 | 결과 | 판정 |
|---|---|---|---|
| A 정밀 | DeepSeek V4.1 Flash (high) | 229건/982,680 chars, dedup 4/3,767, 3.99% | 일치 |
| B 엔진측 | MiniMax M3.1 Flash | 미러↔원본 **229/229, dedup 4/4, replace 233/233, substitution 237/237 — 불일치 0.00%** | 일치 |
| C 비용 | DeepSeek V4.1 Flash | 233건/986,447 chars/47,050,795 tokens/3.99%, 가격 최소자승 적합 | 일치 |
| E 추이 | Iceman Contributor Free(무료) | 228건/972,003 chars | 1건 차이 — 원본에 `tool result middle pruned`가 있던 1건을 프루너로 오분류(리드 확인) |
| D 감사 | Beam Free 실패 → Iceman 재파견(3회) | 1·2차 0건 오탐, 3차는 229/982,680까지 일치하나 dedup 0 오판(append 트랩) | 리드·A 감사로 dedup 4건 확정(정정문서) |

리드 독립 확인: ① 하네스 세션 로그 ↔ 엔진 미러 두 경로에서 229/982,680 재현. ② 프루너 혼입 0(창 내 프루너 재작성 0, 코퍼스 전체 179건은 모두 창 이전). ③ dedup은 replace가 아니라 append 이벤트라 replace-only 스캔은 0건으로 놓친다. ④ 자기팽창 0, 최소 입력 3,719. ⑤ 스냅샷 중복 0, 경계 중복 0, 세션 이중계산 0.

## 8. 주의사항

- **cache-read**: 창 prompt의 98.88%가 캐시 재읽기. "3.99%"는 토큰 수 기준이며 청구 금액 기준이 아니다.
- **상한값**: 렌즈 2는 재작성이 창 끝까지 유지되고 이후 모든 요청이 전문을 재전송한다고 가정한 상한이다.
- **표본 편중**: 8개 장기 세션에 100% 집중. 짧은 세션은 cold(15턴)에 도달하지 않아 절감이 거의 없다.
- **구조적 자기팽창 위험**: floor 3,700은 입력 크기 하한일 뿐 출력 크기 상한이 아니다(코드에 `summary.length >= text.length` 거부 invariant 미구현).
- **BRIEF 표본 오기**: 문서에 적은 seq 1681→35 예시는 session-10518982 소속이며 16358e59가 아니다(A가 정정). 측정 방법 자체는 유효.
- toolprune·microskills는 이 라우트에서 실효 0이므로 "절감기 전체" 평가는 tiering만 보면 된다.

## 9. 재현

```bash
cd /home/minami/Workspace/projects/dsh-workspace/dsh-plugins
node artifacts/token-saving-3d/a-primary/measure.mjs     # A 정밀
node artifacts/token-saving-3d/b-engine/measure.mjs      # B 엔진측 교차
node artifacts/token-saving-3d/c-cost/measure.mjs        # C 비용·반사실
node artifacts/token-saving-3d/e-trend2/trend2.mjs       # E 일별 추이
```

원자료: `~/.dsh/sessions/<project>/<session>/session.v4.jsonl.zstd`, 엔진 상태 `~/.tokeneconomizer` — 둘 다 읽기 전용으로만 사용했고 측정 중 아무것도 쓰지 않았다.
산출물: `artifacts/token-saving-3d/{a-primary,b-engine,c-cost,d-audit,e-trend2}/`
