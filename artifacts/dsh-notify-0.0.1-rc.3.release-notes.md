<!-- GitHub release body for Nolitor/dsh-notify v0.0.1-rc.3. English is the default; the Korean section follows. -->

## Read this first: the version number went **down**, on purpose

This release is `0.0.1-rc.3`. The previous release on this repository was `v0.2.1`.
**The version did not regress because work was undone.** Two separate things happened, and
neither was ever written down here — that is the omission this release body fixes.

### 1. `0.2.x` was never this plugin

`v0.2.0` and `v0.2.1` on this repository were releases of the **Windows PowerShell/WPF
prototype** (a tray widget that polled the DeepSeek billing window). The browser plugin lived
inside that same repository, nested under `plugin/`, at version `0.2.1` — sharing a version
number with the Windows app by accident, not by design.

### 2. The `@nolit` version ladder was reset by owner decision on 2026-11-05

Every `@nolit` package was moved to a single scheme, `0.0.1-rc.N`, where **only the `rc#`
moves**. That is why the numbers look lower: `0.1.8` and `0.2.1` were not comparable
milestones under the new scheme — they were replaced by it.

| Surface | Before | After |
| :--- | :--- | :--- |
| Version scheme | per-track, drifting (`0.1.6 → 0.1.7 → 0.1.8 → 0.2.1`) | **`0.0.1-rc.N`**, one ladder for every `@nolit` package |
| This package | `@nolit/dsh-notify-web` @ `0.2.1`, nested in `plugin/` | **`@nolit/dsh-notify`** @ `0.0.1-rc.3`, at the repository root |
| Repository layout | Windows prototype at root, plugin in `plugin/` | plugin at root, Windows prototype preserved in `prototype-windows/` |

The rename from `-web` to `@nolit/dsh-notify` is also part of this release. The `-web` suffix
was carried from the 2026-10-24 recovery and was never the owner's choice; `PROVENANCE.md`
documented the package as `@nolit/dsh-notify` the whole time while the files said `-web`.

---

## What is new since `v0.2.1`

### 7-segment DeepSeek peak countdown chip

A live `HH:MM:SS` chip in the Session header showing the time left in the current DeepSeek
billing window. Green while off-peak, red at peak, driven by the fixed UTC window definition
(01:00–04:00 and 06:00–10:00, Mon–Fri, excluding Chinese public holidays evaluated on the
Beijing calendar day). The chip is inline SVG — no font, no stylesheet, every stroke a
`--dsw-*` theme token.

### Peak/off-peak transitions are announced

When the window flips, the plugin sends the same Chrome notification it uses for turns and
also sets `setAppBadge` plus a `●` tab-title marker, so a background tab still tells you.

### Chrome notification is now the only audio-free channel

The Web Audio chime, the inline WAV beep, `<audio>`, BYO audio upload, IndexedDB audio storage
and every sound setting were removed. Chrome notification is primary; the native DSH toast is
the **silent** fallback when the browser blocks notifications. Measured: `AudioContext`
references 3 → 0, `indexedDB` references 4 → 0.

### No self-authored stylesheet

The injected `NOTIFY_CSS` (26 `.dshNbx*` rules in `document.head`) is gone. Every surface now
uses native DSH primitives and live typography tokens
(`var(--dsh-content-font-size, 14px)`), so Settings → font size is honoured. Hardcoded pixel
sizes: 5 → 0. Hardcoded `font-family`: 1 → 0.

### English default, Korean by locale

The client is English by default; Korean comes only from the baked dictionary and only while
the host locale is Korean. Hardcoded Hangul in code paths: 1,009 characters → 0 outside the
dictionary.

---

## Install

```bash
dsh plugin --profile web add @nolit/dsh-notify
```

The package must be listed in the profile's `dsh.profile.bundles`. Reload the DSH page after
installing.

**npm:** `@nolit/dsh-notify@0.0.1-rc.3` · dist-tags `rc` and `latest`
**Verify:** `npm test` → 69/69 passing

## Assets

This release has no binary asset. The package is distributed through npm; the Windows
prototype it was recovered from ships inside the package under `prototype-windows/` (62 files,
not runnable on Linux).

---

## 한국어

## 먼저 읽어주세요: 버전 숫자가 **내려간** 이유

이 릴리스는 `0.0.1-rc.3`입니다. 이 저장소의 직전 릴리스는 `v0.2.1`이었습니다.
**작업이 되돌려져서 버전이 내려간 것이 아닙니다.** 두 가지가 겹쳤고, 둘 다 여기에 한 번도
기록된 적이 없습니다. 이 릴리스 본문이 그 누락을 바로잡습니다.

### 1. `0.2.x`는 이 플러그인의 버전이 아니었습니다

이 저장소의 `v0.2.0`, `v0.2.1`은 **Windows PowerShell/WPF 프로토타입**(딥시크 과금 구간을
폴링하던 트레이 위젯)의 릴리스였습니다. 브라우저 플러그인은 같은 저장소의 `plugin/`
하위에 `0.2.1`로 들어 있었는데, 이는 설계가 아니라 우연히 같은 번호를 쓰게 된 것입니다.

### 2. `@nolit` 버전 사다리가 2026-11-05 소유자 결정으로 재설정됐습니다

모든 `@nolit` 패키지를 **`0.0.1-rc.N`** 한 가지 체계로 통일했고, **`rc#`만 올라갑니다.**
숫자가 낮아 보이는 이유가 이것입니다. `0.1.8`과 `0.2.1`은 새 체계에서 비교 가능한
마일스톤이 아니었고, 새 체계로 대체됐습니다.

| 표면 | 이전 | 이후 |
| :--- | :--- | :--- |
| 버전 체계 | 트랙마다 제각각 (`0.1.6 → 0.1.7 → 0.1.8 → 0.2.1`) | **`0.0.1-rc.N`** 단일 사다리 |
| 이 패키지 | `@nolit/dsh-notify-web` @ `0.2.1`, `plugin/` 하위 | **`@nolit/dsh-notify`** @ `0.0.1-rc.3`, 저장소 루트 |
| 저장소 구조 | 루트에 Windows 프로토타입, 플러그인은 `plugin/` | 루트에 플러그인, Windows 프로토타입은 `prototype-windows/`에 보존 |

`-web` → `@nolit/dsh-notify` 개명도 이 릴리스에 포함됩니다. `-web` 접미사는 2026-10-24
복구 당시 붙은 것으로 소유자가 고른 이름이 아니었고, `PROVENANCE.md`는 내내
`@nolit/dsh-notify`로 기록하고 있었습니다. 문서와 파일이 서로 달랐던 것입니다.

## `v0.2.1` 이후 새로 추가된 것

### 딥시크 피크 7세그먼트 카운트다운 칩

세션 헤더에 `HH:MM:SS` 칩을 띄워 현재 딥시크 과금 구간의 남은 시간을 보여줍니다.
오프피크는 초록, 피크는 빨강입니다. 구간 정의는 고정 UTC 기준(01:00–04:00, 06:00–10:00,
월–금, 중국 공휴일 제외)이며 공휴일은 베이징 달력 날짜로 판정합니다. 칩은 인라인 SVG라
폰트도 스타일시트도 쓰지 않고 모든 획이 `--dsw-*` 테마 토큰입니다.

### 피크/오프피크 전환 알림

구간이 바뀌면 턴 알림과 같은 Chrome 알림을 보내고, `setAppBadge`와 `●` 탭 제목 표시도
함께 설정합니다. 백그라운드 탭에서도 상태 전환을 알 수 있습니다.

### 오디오를 완전히 제거했습니다

Web Audio 차임, 인라인 WAV 비프, `<audio>`, 사용자 오디오 업로드, IndexedDB 오디오 저장,
모든 사운드 설정을 제거했습니다. Chrome 알림이 기본이고, 브라우저가 알림을 막으면
**소리 없는** 네이티브 DSH 토스트로 대체합니다. 측정: `AudioContext` 참조 3 → 0,
`indexedDB` 참조 4 → 0.

### 자체 스타일시트 제거

`document.head`에 주입하던 `NOTIFY_CSS`(26개 `.dshNbx*` 규칙)를 없앴습니다. 모든 표면이
네이티브 DSH 프리미티브와 라이브 타이포그래피 토큰
(`var(--dsh-content-font-size, 14px)`)을 쓰므로 설정의 글자 크기를 따릅니다.
하드코딩 픽셀 크기 5 → 0, 하드코딩 `font-family` 1 → 0.

### 영어 기본, 한국어는 로케일을 따름

클라이언트는 영어가 기본이고, 한국어는 내장 사전에서만, 호스트 로케일이 한국어일 때만
나옵니다. 코드 경로의 하드코딩 한글: 사전 밖 1,009자 → 0.

## 설치

```bash
dsh plugin --profile web add @nolit/dsh-notify
```

프로필의 `dsh.profile.bundles`에 등록되어야 합니다. 설치 후 DSH 페이지를 새로고침하십시오.

**npm:** `@nolit/dsh-notify@0.0.1-rc.3` · dist-tag `rc`, `latest`
**검증:** `npm test` → 69/69 통과

## 자산

이 릴리스에는 바이너리 자산이 없습니다. 패키지는 npm으로 배포되며, 복구 원본인 Windows
프로토타입은 패키지 안 `prototype-windows/`에 62개 파일로 들어 있습니다(Linux에서는 실행
불가).
