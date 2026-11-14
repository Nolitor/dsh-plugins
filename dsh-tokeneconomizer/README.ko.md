# @nolit/dsh-tokeneconomizer

<!-- skeleton:
version: 1.5
kind: readme
status: active
updated: 2026-11-14
summary: microsoft/TokenEconomizer용 DSH 0.2.2 브리지 — 생명주기 매핑, 인메모리 도구 마스크, DSH trace 리더, 가드된 마이그레이션, 하네스 인덱스를 통한 이전 세션 회상, 호스트 로컬 인메모리 기능, Web 개발자 통계 카드. (한국어판)
-->

> 이 문서는 [README.md](README.md)의 한국어 번역이다. 두 문서가 어긋날 때는 영문판이 정본이다.

[microsoft/TokenEconomizer](https://github.com/microsoft/TokenEconomizer) (Apache-2.0, 고정 커밋
`6141bb92`)의 DSH 쪽 브리지다. 절약 동작은 TokenEconomizer의 stdlib 전용 Python 엔진에 그대로 두고,
이 패키지는 DeepSeek Harness의 에이전트 생명주기를 그 엔진이 이미 말하는 훅 계약으로 번역하고, 그
응답을 DSH 자체의 레버로 적용한다.

호스트 로컬 기능은 `node:` 내장만으로 Host 프로세스 안에서 돈다: 도구 결과 해시 중복 제거,
KV 캐시 안전 프롬프트 슬롯, 루프 차단기와 권고형 사고 워치독, 그리고 최신 턴은 그대로 두고 중간 턴은
요약하며 오래된 턴은 내보내는 턴 기반 계층 메모리. 자세한 내용은
[docs/IN_MEMORY_FEATURES.md](docs/IN_MEMORY_FEATURES.md)에 있다.

`0.2.0`에서 의도적으로 새 저장소를 만들지 않은 두 가지:

- **이전 세션 회상**은 같은 저장소의 이전 세션을 하네스 자체의 FTS5 인덱스(`ctx.sessionQuery`)에
  묻는다. 이 패키지는 그 데이터베이스를 열지도 쓰지도 않는다. 조합이 검색을 꺼둔 상태면 회상은
  조용한 무동작이다.
- **저장소 키**(`lib/repokey.js`)는 엔진의 `repos/<slug>-<sha1[:10]>` 규칙을 순수 Node로 재현한다.
  그래서 세션의 `cwd`가 두 번째 식별 체계 없이 같은 키로 매핑된다.

| 메커니즘 | DSH 레버 | 기록 위치 |
|---|---|---|
| micro-skills (학습된 저장소 사실) | 에이전트 스코프의 `systemPrompt.context()` | 세션 컨텍스트에만 |
| 도구 프루닝 (증거 기반 deny 목록) | 에이전트 스코프의 `tools.restrict({ deny })` | 메모리; 소스 설정은 편집하지 않음 |
| 루프 가드 (막힌 턴 리다이렉트) | user-role 컨텍스트 하나를 `agent.inject()` | 세션 로그, inbox 이벤트를 통해 |
| 이전 세션 회상 | `ctx.sessionQuery.searchSessions`에서 한 번 `agent.inject()` | 세션 로그; 인덱스는 DSH 소유 |
| 세션 다이제스트 | 압축 해제한 세션 export 후 분리된 `te fold` | `$TOKENECONOMIZER_HOME` |
| 도구 결과 중복 제거 | `tools/post-execute` 콘텐츠 교체 | 메모리; 포인터가 결과와 함께 기록됨 |
| KV 캐시 안전 프리픽스 슬롯 (+ Think-in-Code 라우팅) | 에이전트 스코프의 `systemPrompt.section()` | 메모리; 텍스트는 요청의 첫 메시지에 존재 |
| 루프 차단기와 사고 워치독 | `agent.inject()`; `watchdogAction: interrupt`일 때만 `agent.cancel()` | 메모리; 알림은 stderr와 트랜스크립트에 도달 |
| 도구 출력의 계층 메모리 | 세션 표면 재작성 (`compaction/prune` + 교체된 `tool/result`) | 내구 로그는 원본을 유지; 모델 컨텍스트는 포인터를 유지 |

## 설치

```sh
# 1. 패치된 엔진을 물질화한다 (고정 업스트림 커밋을 클론하고,
#    patch/0001-add-dsh-host.patch를 적용하고, <state root>/bin/te 와 bin/te-hook을 쓴다).
#    그 다음 가장 최근 완료 세션 20개를 자동 마이그레이션한다 (--no-migrate로 건너뜀).
node scripts/bootstrap.mjs

# 2. 이 번들을 프로필에 설치한다
dsh plugin --profile web add link:$PWD
# 그 다음 $DSH_HOME/profiles/web/package.json의 dsh.profile.bundles에
# "@nolit/dsh-tokeneconomizer"를 추가하고 그 프로필을 재시작한다

# 3. 남은 모든 세션을 마이그레이션한다 (bootstrap 단계는 상한이 있다)
node bin/te-dsh.mjs cold-start
```

`dsh plugin add`는 패키지를 설치하지만 조합하지는 않는다. 패치 행이 적용되려면 번들이
`dsh.profile.bundles`에 올라 있어야 한다. `--dump-config` 통과는 그 행이 마운트된다는 증거가 아니다.
세션 후 `te-dsh status`와 `$TOKENECONOMIZER_HOME/errors.log`를 확인하라.

이전 세션 회상이 뭔가를 하려면 조합이 하네스 자체 인덱스를 켜야 한다. 배포 기본값은 꺼진 상태
(`path: ':memory:'`, `openAt: never`)이므로 프로필 패치에 행 하나를 추가한다. 설정 객체는 통째로
교체되므로 두 키가 모두 필요하다:

```yaml
- id: session-query-sqlite
  config:
    path: /absolute/path/to/session-search.db
    openAt: startup   # 또는 first-search
```

## 명령

```sh
node scripts/bootstrap.mjs [--source <checkout>] [--sha <commit>] [--home <state root>]
                           [--verify-only] [--no-migrate] [--migrate-limit N]
node bin/te-dsh.mjs cold-start [--dsh-home <dir>] [--limit N] [--all] [--dry-run]
                               [--reimport] [--only <repoKey>] [--include-missing]
node bin/te-dsh.mjs purge [--exports] [--state] [--all] [--dry-run] [--yes]
node bin/te-dsh.mjs status [--cwd <dir>]
node bin/te-dsh.mjs doctor
npm test
```

`cold-start`는 기본적으로 세 가지를 건너뛰고, 각각 덮어쓸 수 있다: 이 state root가 이미 폴드한
세션(`--reimport`), 이미 턴을 담은 레코드가 있는 세션(`--reimport`), 작업 디렉터리가 더 이상
존재하지 않는 세션(`--include-missing`) — 그렇지 않으면 일회용 테스트 트리가 존재한 적 없는
저장소가 되어 그 잡음이 도구 프루닝 증거에 섞인다. 전체 실행은 오래된 것부터 폴드하고,
`--limit`은 최신 N개를 폴드한다.

`purge`는 이 패키지의 엔진 상태를 제거하고 state-root 디렉터리 자체는 유지한다. `~/.dsh/sessions`는
절대 건드리지 않는다. 그것은 DSH 소유이므로, 트랜스크립트에 이미 기록된 주입 블록과 프루닝된
표면은 DSH 곁에 그대로 남는다.

## 모드 — 절약은 끄고 추적은 켜기

`mode: apply`(기본)는 토큰을 절약하고 증거를 기록한다. `mode: observe`는 같은 증거(엔진 훅, 사용량
카운터, 세션 export)를 기록하되 아무것도 주입하지 않는다: 고정 규칙 없음, 회상 없음, 포인터 치환
없음, 루프 가드 리다이렉트 없음, 표면 재작성 없음, 워치독 주입 없음. 따라서 절약을 끄는 것이
추적을 멈추지 않고, 나중에 다시 켜면 작업할 이력이 남아 있다.

엔진 자체 설정은 그대로 적용된다(`te config set microskills=on`, `loopguard=off`, …). 이 플러그인은
각 응답을 적용할지만 결정한다(`lib/index.js`의 `DEFAULTS` 참고).

이 패키지는 `node:` 내장 밖에서 아무것도 import하지 않는다. 하네스 패키지를 import하지 않으므로
프로필이 피어 의존성 없이 마운트할 수 있고, TokenEconomizer 엔진에는 `child_process`(`te`,
`te-hook`)를 통해서만 도달한다.

## 개발자 통계 (Web)

Web 클라이언트 절반(`lib/client.js`)은 `settings.section` 좌석 하나 `tokeneconomizer-devstats`
(order 62)를 추가하고, 읽기 전용 턴별·단계별 컨텍스트·캐시·모델·도구 측정을 보여준다. 수치는 호스트
라우트 `POST /api/local/tokeneconomizer/devstats`에서 온다. 도출 규칙과 그것이 따르는 DSH 원장
어휘는 [docs/DEV-STATISTICS.md](docs/DEV-STATISTICS.md)에 있다.

카드는 DSH 설정 표면 규칙을 따른다:

| 표면 | 규칙 |
|---|---|
| 너비 | 섹션은 `max-width: 720px`에서 멈추고 스스로 가운데 정렬하므로 넓은 패널을 가로질러 늘어나지 않는다 |
| 제목 | 섹션 제목은 `h2`, 각 카드 제목은 `h3`로 본문 내용보다 한 단계 위이며 DSH 콘텐츠 폰트 토큰에서 크기를 받는다 |
| 스타일시트 | 스타일시트는 `data-plugin-css="@nolit/dsh-tokeneconomizer"`로 키가 잡혀 있어 호스트가 소유하고, 리로드는 사본을 쌓는 대신 교체한다 |
| 표 | 턴별 표는 고정 헤더 행과 함께 자체 `280px` 프레임 안에서 스크롤되며, 모든 열 헤더는 `scope="col"`을 갖는다 |
| 포커스와 모션 | 모든 컨트롤은 DSH 포커스 토큰의 `:focus-visible` 링을 보이며, 장식적 전환은 `prefers-reduced-motion: reduce`에서 제거된다 |
| 세션 선택기 | 옵션 라벨은 작업 디렉터리 더하기 **전체** 세션 id이므로 한 디렉터리의 두 세션이 구별된다 |

플러그인 자체 로케일 파일이 표시 제목을 담는다: `locale/en.json`은
`TokenEconomizer (MS tokeneconomizer)`이고 `locale/ko.json`은 한국어 제목을 유지한다.

## 구성

```
lib/index.js        Cordis 플러그인: DSH 생명주기 매핑
lib/bridge.js       프로세스 경계: te-hook, dsh-session, dsh-import, exports
lib/repokey.js      호스트 로컬: cwd를 엔진의 저장소 키로, 순수 Node로
lib/dedup.js        호스트 로컬: 도구 결과 해시 중복 제거
lib/prefix.js       호스트 로컬: KV 캐시 안전 프롬프트 슬롯, 그 라우팅 텍스트와 가드
lib/watchdog.js     호스트 로컬: 루프 차단기와 권고형 사고 워치독
lib/tiering.js      호스트 로컬: 도구 출력의 턴 기반 계층 메모리
lib/devstats.js     커밋된 세션 원장의 턴별/단계별 폴드
lib/devstats-server.js  통계 카드 뒤의 읽기 전용 호스트 라우트
lib/client.js       Web 절반: settings.section 통계 카드
bin/te-dsh.mjs      운영자 명령: bootstrap, cold-start, purge, status, doctor
scripts/bootstrap.mjs  고정 클론 + 패치 + 런처 + 검증 + 상한 있는 마이그레이션
patch/              업스트림 엔진용 DSH 호스트 패치 (파일 7개, 새 리더 1개)
test/               node --test: 브리지 형태, 모듈 로드, 패키지 계약,
                    호스트 로컬 기능, 저장소 키 동등성, 부트스트랩된 엔진을 통한
                    종단 간 세션 1건
docs/               아키텍처, 운영, 호스트 로컬 기능
```

설계 근거, 이벤트별 계약, 상태/원장 형식은 [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)에 있다.
호스트 로컬 인메모리 기능은 [docs/IN_MEMORY_FEATURES.md](docs/IN_MEMORY_FEATURES.md)에 있다.
설치, 마이그레이션, purge, 롤백 절차는 [docs/OPERATIONS.md](docs/OPERATIONS.md)에 있다.
