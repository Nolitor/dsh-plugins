# Lightpanda 마이그레이션 타당성 조사 보고서 (읽기 전용 실측)

> ⚠️ **이 문서는 1차 조사 기록이며, 일부 결론이 후속 실측으로 정정되었다.**
> 특히 §4.5의 "`browser.close()`가 데몬을 죽인다"는 **오판**이었다.
> 최신 사실·구축 결과·비교 측정은 [lightpanda-deployment-report.ko.md](lightpanda-deployment-report.ko.md)를 본다.
> 이 문서는 "조사 단계에서 무엇을 어떻게 판단했는가"의 이력으로만 보존한다.

- 조사 시각: 2026-11-02 06:0x KST
- 조사 범위: `dsh-plugins` 워크스페이스 + 호스트 런타임
- 조사 성격: **읽기 전용(Read-Only)**. 설치·데몬 기동·포트 개설·소스 수정 **없음**
- 작성 위치: `.runtime-measure/` → 이후 `artifacts/`로 이동

---

## 0. 선행 사실 — 이전 턴 중단

이전 턴은 **실행 전에 끊겼습니다.** 근거:

| 확인 항목 | 실측 결과 |
|---|---|
| 워크스페이스 내 최근 14시간 신규 파일 | 0건 |
| Playwright/Lightpanda 관련 산출물 | 없음 |
| `git status` 변경 | tokeneconomizer 관련 기존 수정분만 존재 (이번 작업과 무관) |

즉 이번 보고서가 **최초의 실측 결과**이며, 이전 턴에서 부작용은 없습니다.

부수 관측: 이 세션의 `skill` 툴로 `interrupt-guide` 로드 시
`Error: loaded skill "interrupt-guide" source must be a string` 오류 발생.
스킬 카탈로그에는 노출되나 로더가 실패하는 상태입니다(이번 조사 범위 밖, 별건 보고 대상).

---

## 1. 네트워크 · 포트 현황

### 1.1 현재 LISTEN 중 (실측, `ss -tlnp`)

| 포트 | 바인드 | 프로세스 | 비고 |
|---|---|---|---|
| 3080 | 127.0.0.1 | MainThread pid 2482449 | **DSH Web (사용자 라이브 서버 — 건드리지 않음)** |
| 80 / 443 | 0.0.0.0 / [::] | (nginx 계열) | 외부 서비스 |
| 22 | 0.0.0.0 | sshd | |
| 631 | 127.0.0.1 / [::1] | cups | |
| 8080, 8082 | 0.0.0.0 / 127.0.0.1 | llama-server (pid 1197, 1412) | 추론 서버 |
| 8787, 8788, 9119, 9120 | 0.0.0.0 / 127.0.0.1 | hermes / python | |
| 41179, 45901, 40119, 38657 | 127.0.0.1 | language_server | IDE 계열 |
| 49374 | 127.0.0.1 | opencode.exe | |
| 38343, 38639 | 127.0.0.1 | antigravity | |
| 17799, 8088, 46255, 35087 | 127.0.0.1 / 0.0.0.0 | python | |
| 53 | 127.0.0.53, 127.0.0.54 | systemd-resolved | |

총 LISTEN 소켓: **32개**(TCP). UDP 포함 43바인딩.

### 1.2 후보 포트 실측 (충돌 검사 완료)

| 포트 | 상태 |
|---|---|
| 9222 (Lightpanda/Docker 기본값) | **비어 있음** |
| 9223, 9227, 9229 | **비어 있음** |
| 9333, 9334 | **비어 있음** |
| 3099 (E2E 격리 포트) | **비어 있음** |
| 3000, 4000, 5555 | **비어 있음** |

→ 기본값 9222는 지금 비어 있으나, **Docker 공식 이미지·문서·타 도구 기본값과 겹침**.
권장: **9333** 또는 **9227** + `127.0.0.1` 바인드. 바인드 직전 재확인 필수.
Lightpanda는 `--unix-socket`(0600)도 지원 → 포트 자체를 없애는 선택지도 유효.

---

## 2. 호스트 · 툴체인

| 항목 | 실측값 |
|---|---|
| OS | Pop!_OS 24.04 LTS, kernel 7.1.5-76070105, x86_64 |
| glibc | 2.39 (Lightpanda 요구 2.35 이상 → **충족**) |
| CPU / RAM | 16 core / 31.5GB (가용 23.9GB) |
| Disk | 306GB 여유 |
| node / npm / pnpm | v24.22.1 / 11.19.1 / 11.28.5 |
| yarn / bun / deno | **모두 미설치** |
| PATH | `~/.local/nodejs/bin`, `~/.local/bin` 포함 |
| 시스템 Chrome/Chromium | **없음** |
| Lightpanda | **미설치** |

---

## 3. Playwright 현재 상태 (전수 추적)

### 3.1 의존성

| 위치 | 선언 | 실제 설치 |
|---|---|---|
| `dsh-sidebar-manager/prototype-harness/e2e/package.json` | `playwright-core: 1.63.0` | **node_modules 없음 (미설치)** |
| `.runtime-measure/*.mjs` (23개) | 없음(선언 없이 절대경로 require) | `~/.bun/install/cache/playwright-core@1.64.1@@@1` |
| 전역 npm | — | 없음 |
| Python venv(`minamiv21`) | playwright 1.63.0 | 존재 (무관 프로젝트) |

### 3.2 실행 지점

1. **`dsh-sidebar-manager/prototype-harness/e2e/run-e2e.mjs:250`** — 유일한 "정식" 하네스
   - `chromium.launch({ headless: true, executablePath: CHROME })`
   - `CHROME` = `%LOCALAPPDATA%\ms-playwright\chromium-1243\chrome-win64\chrome.exe`
   - `powershell Get-NetTCPConnection`으로 포트 점유 PID 조회
   - 격리 `DSH_HOME` + 포트 3099, 55개 체크, Phase A/B 재시작 검증
   - **결론: Windows 전용. 이 Linux 호스트에서는 그대로 실행 불가.**
2. **`.runtime-measure/` 23개 스크립트** — 실제 이 호스트에서 쓰인 패턴
   - 공통 형태:
     ```js
     const { chromium } = require('/home/minami/.bun/install/cache/playwright-core@1.64.1@@@1')
     const browser = await chromium.launch({
       headless: true,
       executablePath: '/home/minami/.cache/ms-playwright/chromium-1248/chrome-linux64/chrome',
       args: ['--no-sandbox','--disable-dev-shm-usage']
     })
     ```
   - 19개는 동일 포맷, 4개는 압축 표기 — **동일 정책이 23곳에 복붙**된 상태
   - 23/23 모두 `browser.close()` 호출 (누수 없음)
   - 대상은 `process.argv[2]`로 받은 URL (DSH Web 토큰 URL 포함)
   - 이 디렉터리는 **gitignore 대상** → 팀 공유 자산 아님

### 3.3 구조적 취약점 (실측 근거)

- `bun` 바이너리는 **없는데** 스크립트는 `~/.bun/install/cache/...` 절대경로에 의존
  → bun 캐시 정리 시 23개 스크립트 전부 즉사
- 브라우저 캐시 약 **1.34GB** (`~/.cache/ms-playwright`)
  - chromium-1243 393M, chromium-1248 403M, headless_shell 261M/273M, ffmpeg 10M
- `connectOverCDP` 사용처 **0건** — CDP 경유 패턴은 아직 코드베이스에 없음

### 3.4 베이스라인 (실측, chromium-1248, headless)

| 시나리오 | launch | nav | total | PSS | 프로세스 |
|---|---|---|---|---|---|
| A. about:blank (하한) | 117ms | 140ms | **257ms** | **318MB** | 12 |
| B. 로컬 5,000노드 DOM + JS | 117ms | 189ms | **306ms** | **368MB** | 12 |
| C. 라이브 DSH(3080, 미인증) | 105ms | 130ms | **235ms** | **321MB** | 12 |

보조 측정: `chrome-headless-shell` 바이너리 `--dump-dom about:blank` = **0.12s / 96MB**
(풀 Chromium 0.90s / 203MB 대비 경량 — 다만 이건 단발 dump 경로)

주의: C는 **HTTP 401**입니다. DSH Web은 토큰 URL이 필요해, 실제 UI 부하는 토큰 확보 후 재측정 필요.

---

## 4. Lightpanda 마이그레이션 검토

### 4.1 현황 (외부 자료)

- 2026-10 **v1.0 정식 릴리스**. Zig로 작성, Chromium 포크 아님
- 설치 경로: `npm i @lightpanda/browser`(현재 1.6.0) / `pkg.lightpanda.io` 설치 스크립트 / GitHub nightly 바이너리 / Docker
- CDP 서버: `lightpanda serve --host 127.0.0.1 --port <P>` (+ `--unix-socket` 지원)
- 공식 벤치마크: 메모리 약 16배, 실행 약 9배 우위 (100페이지 기준 123MB vs 2GB)
- **렌더링 엔진 없음** — CSS 레이아웃/페인트 미구현
- Playwright/Puppeteer CDP 호환은 문서상 여전히 **WIP** 표기

### 4.2 판정: **전면 교체 불가, 부분 적용 가능**

| 용도 | 판정 | 근거 |
|---|---|---|
| `run-e2e.mjs` (55개 UI 체크) | **부적합** | `isVisible()`, `hover()`, `count()` 기반 실제 렌더 UI 검증. 렌더링 엔진 부재로 가시성/히트테스트 의미 불일치. + 하네스 자체가 Windows 전용 |
| `.runtime-measure/` DOM 덤프·JSON 추출류 | **적합 후보** | 텍스트/DOM 읽기 중심, 렌더 불필요 |
| 향후 스크래핑 / API 응답 수집 | **적합** | 정적 페이지·JSON 중심 워크로드 |

### 4.3 설치 방안 (승인 시 실행할 것)

- 방식 A(권장): pinned 릴리스 바이너리 → `~/.local/bin/lightpanda` (root 불필요, PATH 이미 포함)
- 방식 B: `npm i @lightpanda/browser@1.6.0` 전용 디렉터리 (lockfile로 재현성 확보)
- 공통: `LIGHTPANDA_DISABLE_TELEMETRY=true`, `LIGHTPANDA_DISABLE_CORE_DUMP=1` 설정

### 4.4 데몬 구성 (승인 시)

```
~/.local/bin/lightpanda serve \
  --host 127.0.0.1 --port 9333 \
  --log-format pretty --log-level info
```
- 9333은 실측 공백. 9222는 Docker/문서 기본값이라 회피
- systemd user unit 또는 관리형 백그라운드 job으로 1개만 유지
- 검증: `curl -s http://127.0.0.1:9333/json/version`

### 4.5 코드 변환 전략

1. **공통 런처 모듈 1개로 집약** — 23곳 복붙 제거
   ```js
   // browser.mjs (신규)
   export async function openBrowser({ cdp } = {}) {
     if (cdp) return chromium.connectOverCDP(cdp)          // Lightpanda
     return chromium.launch({ headless: true, executablePath, args })
   }
   ```
2. **수명주기 변경이 핵심 리스크**
   - `connectOverCDP`로 붙은 브라우저에 `browser.close()`를 호출하면 **원격 브라우저(=데몬)가 종료**됨
   - 현재 23개 스크립트가 전부 `browser.close()` 호출 → 그대로 두면 공유 데몬이 매 실행마다 죽음
   - 대응: (가) 실행마다 데몬 spawn→연결→종료(현행 launch와 동등) 또는 (나) 단일 소비자 순차 실행 + 종료 시 데몬 재기동
3. **스모크 테스트 선행** — 변환 전에 `connectOverCDP` + `goto` + `evaluate`만으로 Lightpanda CDP 호환성 실측
4. **단계적 적용** — `.runtime-measure/` 읽기 전용 스크립트 1~2개 → 검증 후 확대. E2E 하네스는 Chromium 유지

### 4.6 예상 리스크

| 리스크 | 영향 | 완화 |
|---|---|---|
| Playwright CDP 호환 WIP | locator/expect 계열 실패 가능 | 스모크 테스트로 사전 판정, 실패 시 Puppeteer-core 우회 |
| 렌더링 부재 | 가시성·스크린샷·좌표 클릭 불가 | 해당 용도는 Chromium 유지 |
| 데몬 공유 + `browser.close()` | 상호 세션 붕괴 | 실행별 데몬 격리 또는 종료 정책 통일 |
| bun 캐시 절대경로 의존 | 23개 스크립트 동시 붕괴 | npm 로컬 설치로 의존성 고정 |

---

## 5. 승인 요청 (다음 단계)

아래 **3개만** 실행 허가를 요청합니다. 소스 수정은 그 이후입니다.

1. **설치**: Lightpanda pinned 바이너리 → `~/.local/bin/lightpanda` (root 불필요)
2. **데몬**: `127.0.0.1:9333` 1개 기동 + `/json/version` 확인
3. **스모크**: `connectOverCDP` → `goto` → `evaluate` 1회 측정 (기존 23개 스크립트는 **건드리지 않음**)

승인 후 보고 항목: 설치 경로·버전, 실제 바인드 포트, 스모크 성공/실패, Lightpanda vs Chromium 실측 비교표.
