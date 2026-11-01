# Lightpanda 상주 CDP 데몬 구축 · 스모크 · 비교 측정 보고서

- 시각: 2026-11-02 06:20–06:35 KST
- 범위: 설치 → 상주 데몬 → 공통 래퍼 → 스모크 → Chromium 비교
- 원칙: 모든 수치는 실행 결과에서 채취. 추정 없음

---

## 0. 1차 보고 정정 (중요)

1차 보고서에서 "`connectOverCDP`로 붙은 브라우저에 `browser.close()`를 호출하면 공유 데몬이 죽는다"고 **경고**했습니다.
**실측 결과 이는 틀렸습니다.**

| 검증 | 결과 |
|---|---|
| 클라이언트 `browser.close()` 후 데몬 pid | **3216282 유지** (생존) |
| 클라이언트 `SIGKILL` 후 데몬 pid | **3216282 유지**, 신규 접속 정상 |
| Playwright 소스 확인 | 연결 브라우저의 `close()`는 `Browser.close` CDP를 보내지 않고 연결만 닫음 |

→ 따라서 실행마다 데몬을 spawn/kill 하는 우회 설계는 **불필요**합니다. 공용 데몬 1개 + 클라이언트별 컨텍스트 분리로 충분합니다.

---

## 1. 설치 · 상주 데몬 (실측)

| 항목 | 값 |
|---|---|
| 버전 | **1.0.2** (정식 릴리스, 2026-10-23) |
| 바이너리 | `~/.local/bin/lightpanda` (76.4MB, sha256 `ae7d01d2…3f37e19e` **일치 검증**) |
| 유닛 | `~/.config/systemd/user/lightpanda.service` |
| 상태 | `active (running)`, `enabled`, `default.target.wants` 심볼릭 링크 생성 |
| 바인드 | `127.0.0.1:9333` (실측 LISTEN, pid 3216282) |
| `/json/version` | `Lightpanda/1.0`, Protocol 1.3 |
| 유휴 메모리 | **45–47MB** (PSS, 프로세스 1개) |
| 부팅 지속성 | `Linger=yes` 확인 → 로그인 세션 비종속 |

**크래시 복구 실측**: 데몬에 `kill -9` → 4초 내 새 pid(3223869)로 자동 재기동, 스모크 재통과.

> 포트 결정: 9222(도구 기본값) 회피, 실측 공백이던 **9333** 사용. 바인드는 루프백 한정.

---

## 2. 공통 CDP 연결/해제 래퍼

에이전트가 개별 스크립트에 종속되지 않도록 **독립 스택**으로 분리했습니다.

| 파일 | 역할 |
|---|---|
| `~/.local/share/lpd/lib/cdp.mjs` | `connect()` / `withPage()` / `health()` / 시그널 정리 |
| `~/.local/bin/lpd` | 원샷 CLI: `status·fetch·text·eval·extract·smoke` |
| `~/.local/bin/lpd-ctrl` | 데몬 제어: `start·stop·restart·status·logs·health` |
| `~/.local/share/lpd/README.md` | 통합 가이드 |
| `~/.local/share/lpd/node_modules/playwright-core@1.64.1` | 안정 의존성 (bun 캐시 의존 제거) |

**설계 보장**
- 항상 새 컨텍스트 생성 → 클라이언트 간 쿠키/스토리지 격리
- `finally` + SIGINT/SIGTERM/SIGHUP에서 컨텍스트 정리 후 연결 해제
- 데몬 부재 시 조용히 재기동하지 않고 명확한 안내로 실패(exit 3)
- cwd 무관: 설치본 기준 절대경로로 `playwright-core` 해석

**에이전트 통합 3경로**: ①`lpd` CLI ②`withPage()` 모듈 ③생 CDP(`browserURL: http://127.0.0.1:9333`)
→ Antigravity / OpenCode / Hermes 모두 환경 점검 없이 즉시 사용 가능.

---

## 3. 스모크 테스트 (실측)

`lpd smoke` → **ok: true, 111–121ms**

| 단계 | 결과 |
|---|---|
| 접속 | OK (8–16ms) |
| setContent | OK |
| `innerText` (`#h`) | OK = "ok" |
| `locator.count('p.x')` | OK = 2 |
| `evaluate(1+1)` | OK = 2 |
| **클라이언트 종료 후 데몬 생존** | **OK** |

부가: 동시 클라이언트 6개 접속(55ms) 및 병렬 페이지 조작(116ms) 정상, 데몬 PSS 43→59MB.

---

## 4. Chromium vs Lightpanda 동일 워크로드 비교

조건: 로컬 HTTP(127.0.0.1:18333)에서 5,000노드 DOM + JS 페이지. 측정 후 서버 즉시 종료. 메모리는 PSS 합계.

### 4.1 단발 실행 (3회, 안정값)

| 지표 | Chromium (launch) | Lightpanda (상주 CDP) | 개선 |
|---|---|---|---|
| 시작 비용 | **113–119ms** | **8–16ms** | **약 9×** |
| 페이지 로드+DOM | 193–210ms | 20–92ms | 약 3–9× |
| 총 소요(시작 포함) | **306–329ms** | **28–108ms** | **약 5×** |
| 종료 비용 | 135–155ms | 10–12ms | 약 13× |
| 메모리(PSS) | **363–365MB** | **51–52MB** | **약 7×** |
| 프로세스 수 | 11 | **1** | — |

### 4.2 20페이지 순차 크롤

| 지표 | Chromium | Lightpanda | 개선 |
|---|---|---|---|
| 총 시간 | 1519–1573ms | **376–385ms** | **약 4×** |
| 페이지당 | 76–79ms | **19ms** | 약 4× |
| 메모리(PSS) | 487–508MB | **52–53MB** | **약 9×** |
| 수집 결과 | 100,000 rows | 100,000 rows | 동일 |

### 4.3 해석

- Lightpanda 우위는 **"상주 데몬 + 무렌더링"** 구조에서 나옵니다. 프로세스 1개, 50MB대.
- 다만 Lightpanda 수치는 **레이아웃/페인트를 하지 않기 때문**이므로, Chromium이 더 많은 일을 한 결과와 직접 비교하면 과대평가입니다. DOM 파싱·JS 실행 워크로드 한정 비교입니다.

---

## 5. 호환성 실측 (1.0.2)

| 기능 | 결과 |
|---|---|
| `connectOverCDP` | **정상** |
| `goto` (http/https) | **정상** |
| `setContent` | **정상** |
| `locator.count` / `getByRole` / `getByText` | **정상** (5001/1/1) |
| `textContent` / `innerText` / `evaluateAll` | **정상** |
| `fill` / `inputValue` | **정상** |
| `waitForSelector` | **정상** |
| `isVisible` | 값 반환 (렌더 부재로 신뢰 불가) |
| `boundingBox` | **합성값 5×5** → 좌표 자동화 불가 |
| `screenshot` | 바이트 반환하나 렌더 결과 아님 |
| **`locator.click()`** | **타임아웃 실패** |
| `file://` | **미지원** (`UnsupportedProtocol`) |
| 쿠키 (`addCookies`/`cookies`) | **정상** |

### 클릭 실패 원인 분리

| 시도 | 결과 |
|---|---|
| `locator.click()` (기본) | 타임아웃 |
| `click({force:true})` | 명령은 통과, 핸들러 미발화(n=0) |
| `dispatchEvent('click')` | 통과, 핸들러 미발화(n=0) |
| `page.evaluate(el.click())` | 통과, 핸들러 미발화(n=0) |

→ 단순 액션러빌리티 문제가 아니라 **입력/이벤트 경로 자체가 미완성**입니다. `fill`은 되지만 `click`은 안 됩니다.

---

## 6. 결론 · 적용 판정

| 용도 | 판정 | 근거 |
|---|---|---|
| DOM/텍스트 수집, API 응답 긁기, 링크 추출 | **적합 (즉시 적용)** | 4–9× 빠르고 7–9× 가볍고 전부 정상 |
| 다중 에이전트 공용 브라우저 | **적합** | 상주 데몬 + 컨텍스트 격리 + 크래시 생존 검증 |
| 사이드바 E2E 55체크 (`run-e2e.mjs`) | **부적합** | 클릭 불가·렌더 없음·하네스가 Windows 전용 |
| 시각 회귀/스크린샷 검증 | **부적합** | 렌더 결과 아님 |

**권고: 이중 운용(dual-run).** 수집·스크래핑은 Lightpanda(9333 상주), 실제 UI 상호작용은 Chromium 유지.

---

## 7. 현재 상태 / 남은 일

**적용 완료 (재측정 완료)**
- Lightpanda 1.0.2 설치, systemd 상주 데몬 9333, enabled + linger
- 공통 래퍼·CLI·문서 배치, 스모크 통과, 비교표 확보

**미변경 (의도적)**
- `.runtime-measure/` 23개 스크립트: **건드리지 않음**
- `run-e2e.mjs`: **건드리지 않음**
- 소스 코드: 무변경

**선택 대기**
1. `.runtime-measure/` 23개 중 수집형 스크립트를 `lpd`/`withPage()`로 이관 (E2E는 제외)
2. 클릭 이벤트 미완성 이슈를 upstream 보고 (재현 스크립트 있음)
3. Chromium 없이 돌릴 CI용 경량 경로 확정
