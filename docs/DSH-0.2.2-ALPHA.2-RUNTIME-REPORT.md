# DSH 0.2.2-alpha.2 런타임 실측 · 최적화 보고서
<!-- skeleton:
version: 1.0
kind: report
status: completed
updated: 2026-10-29
summary: Runtime measurement and optimization report for the three original plugins on DSH 0.2.2-alpha.2.
-->


> 상태: completed · 최종 갱신: 2026-10-29 · 대상: `dsh-korean-locale`, `dsh-sidebar-manager`, `dsh-notify` · 상위: [README](../README.md)

## 0. 결론 요약

DSH `0.2.2-alpha.2`(Cordis `4.0.6-alpha.1`, Node `v24.22.1`) 환경에서
**현재 구성된 2종(한국어 로케일 + 사이드바 관리자)과 미설치 알림 플러그인 1종**을
실제 `dsh web`으로 부팅해 실측했다. 세 플러그인 모두 Host/Client 부팅과
서빙 boot graph에 정상 진입했고 브라우저 콘솔 오류는 없었다.

| 항목 | 실측 결과 |
|---|---|
| DSH CLI | `0.2.2-alpha.2` |
| Node / Cordis | `v24.22.1` / `4.0.6-alpha.1` |
| `@deepseek-ai/*` 설치 패키지 | 330개, 그중 319개가 `0.2.2-alpha.2` |
| 현재 라이브 web 프로필 | `dsh-korean-locale` + `dsh-sidebar-manager` 링크/번들 활성 |
| 알림 플러그인 | 라이브 미설치, **격리 `DSH_HOME`에서만 링크해 실측** |
| 격리 boot graph | 75 entries (Nolit 3종 모두 포함) |
| 브라우저 UI | `<html lang="ko">`, 한국어 UI, `console`/`pageerror` 0건 |
| 사이드바 관리자 API | 읽기 전용 라우트 5/5 HTTP 200, 음성 대조군 404 |
| 테스트 | Korean verify PASS · Sidebar 123/123 · Notify 19/19 |
| 설치본 vs 작업 트리 | 동일 symlink/inode, tree SHA-256 일치 |
| UTM 수정 흔적 | **탐지됨** — 초기 14-file 패키지 이후 UTM Phase 1–6 소스 추가/수정, 로컬 immutable artifact로 재기준화 |
| OS 알림 데몬 | `org.freedesktop.Notifications` 활성화 불가 → 토스트/사운드 폴백 |

### 적용한 최적화

1. 세 플러그인 manifest의 검증 범위를 `>=0.2.2-alpha.2 <0.3.0`으로 고정.
2. Korean locale을 alpha.2 실제 boot graph 기준으로 재추출:
   **117개 신규 키 추가, 8개 폐기 키 제거 → 68 namespaces / 3,019 keys**.
3. 알림 플러그인의 Cordis peer를 `~4.0.6-alpha.1`로 갱신.
4. 사이드바 관리자 devDependency와 시장/릴리스 메타데이터를 alpha.2 기준으로 갱신.
5. 런타임 문서(`docs/dsh-plugin-runtime-spec.md`, `docs/plugin-boot-card.md`)와
   README의 라이브 구성 설명을 실제 상태로 정정.
6. UTM 수정 가능성을 별도 감사: **라이브 설치본 = 작업 트리**임을 확인했으나,
   작업 트리에는 초기 v0.1.0 패키지 이후 UTM Phase 1–6 변경이 포함되어 있었다.
   재현 가능한 설치/패키지 감사 스크립트를 추가했다.

---

## 1. 실측 환경

```
DSH          /home/minami/.local/nodejs/lib/node_modules/@deepseek-ai/dsh
CLI          /home/minami/.local/nodejs/bin/dsh
DSH_HOME     /home/minami/.dsh (라이브, 읽기 전용 감사)
격리 실측     <workspace>/.runtime-measure/home
프로필        web
브라우저      Playwright Chromium 1248 (headless)
```

실측은 라이브 `~/.dsh`를 변경하지 않기 위해 프로필 package/patch와 절대경로
`node_modules` 링크만 복제한 격리 `DSH_HOME`에서 수행했다. 실제 바이너리는
동일한 `dsh web --no-open --host 127.0.0.1 --port 3099`이며, 격리 프로필에만
`@nolit/dsh-notify-web`을 추가했다.

### 1.1 라이브 프로필 번들 순서

```
@deepseek-ai/dsh-base
@deepseek-ai/dsh-web-app
@deepseek-ai/dsh-experimental-auto-review
@deepseek-ai/dsh-experimental-agent-team-profile
@nolit/dsh-korean-locale
@nolit/dsh-sidebar-manager
```

알림 플러그인은 라이브 `package.json`에 없다. README의 “sidebar-manager는
프로토타입, 미활성” 서술은 실제와 달라 이번 보고서에서 정정했다.

---

## 2. 플러그인별 실측

### 2.1 `@nolit/dsh-korean-locale` v0.2.3

| 검증 | 결과 |
|---|---|
| Host row 로드 | PASS |
| Client factory / boot graph | PASS (`@nolit/dsh-korean-locale/client.js`) |
| `<html lang>` | `ko` |
| UI 표본 | `새 세션`, `워크스페이스 관리자`, `더 보기`, `모델 선택` |
| 콘솔/pageerror | 0건 |
| 사전 패리티 | 68 namespaces / 3,019 keys · en/zh 키·플레이스홀더 패리티 0 |
| 이전 스냅샷 대비 | +117 키, -8 폐기 키 |

업그레이드 직후 실측에서 사이드바 패널 선택 라벨이 영어 `More`로 남는 등
**enabled surface 기준 103개 키 누락**을 확인했다. alpha.2의 실제 served
boot graph 75개 entry를 AST로 재추출해 enabled 누락 103개 + optional 누락
14개(pluginMarket 9, voice-input 5)를 보강했다. 보강 후 `더 보기`로 렌더링됨을
같은 격리 부팅에서 재확인했다. 이후 **영문(en)과 중문(zh) 사전 양쪽**을 다시 추출해
키 집합·추가/누락·플레이스홀더를 대조했고, 현재 추출 가능한 62개 namespace에서
`enMissing=0`, `zhMissing=0`, `enExtra=0`, `zhExtra=0`, placeholder mismatch 0을 확인했다.
나머지 6개 legacy namespace는 alpha.2 client bundle에서 대응 사전이 발견되지 않아
inert 데이터로 유지했다. 마켓/README의 제목·설명도 en/ko 쌍을 유지한다.

### 2.2 `@nolit/dsh-sidebar-manager` v0.1.1

| 검증 | 결과 |
|---|---|
| Host 5서비스 주입 | `connection`, `workspaceRegistry`, `sessionPersistence`, `agents`, `sessions` 모두 실재 |
| Client slots | `sidebar.workspaces.session.row.action`, `sidebar.workspaces.session.menu.item`, `main`, `sidebar.panellist`, `shell.overlay` 정상 |
| 워크스페이스 관리자 패널 | 클릭 후 정상 렌더링 |
| API 읽기 전용 5종 | 200/200/200/200/200 |
| 음성 대조군 | `POST /api/local/sidebar/does-not-exist` → 404 |
| UTM 런타임 상태 재실측 | 라이브 `groups.json` v3 + `workspace.json` 스냅샷을 격리 home에 복제 |
| UTM 그룹 결과 | `groups/list` status=ok, Core 그룹 + 9 members, `groups/view` schemaVersion=3 |
| UTM UI 결과 | Core/HUB/UROH/HQ 트리와 비차단 관찰 4건 렌더링 |
| 단위 테스트 | 123/123 PASS |

실측 라우트:

```
groups/list        200  {"ok":true,"status":"absent",...}
groups/view        200  {"ok":true,"schemaVersion":3,...}
workspace/archived 200  {"ok":true,"items":[]}
workspace/lifecycle 200 {"ok":true,"deprecated":[...],...}
promotion/status   200  {"ok":true,"journal":null}
```

파괴적 라우트(`session/purge`, `workspace/archive`, `promotion/apply` 등)는
실행하지 않았다. 기존 보고된 “rollback이 workspace.json 전체를 덮어쓸 수 있음”
리스크는 코드 변경 없이 retained backlog로 남긴다.

### 2.3 설치본 vs 패키징본 / UTM 수정 실측

질문대로 “라이브에 설치된 sidebar-manager”와 “워크스페이스에 패키징된 트리”가
다를 수 있는지 별도로 감사했다. 결론은 다음과 같다.

| 확인 항목 | 실측 결과 |
|---|---|
| 라이브 프로필 의존성 | `link:/home/minami/Workspace/.../dsh-sidebar-manager` |
| `node_modules/@nolit/dsh-sidebar-manager` | 동일 경로 symlink |
| realpath/inode | 라이브와 작업 트리 동일 |
| 50개 파일 tree SHA-256 | 양쪽 모두 `709e07ea…a27025c` |
| package version / market version | 둘 다 `0.1.1` (감사 시점) |
| 불변 패키지 artifact | 감사 시점 0개 → **이번 작업에서 로컬 `.tgz` 생성** (`8863088d…c74c2`, 82,246 B) |
| 초기 복구 기준 파일 | `RECOVERY-NOTES.md` 기준 14-file 패키지 |
| 복구 이후 추가 파일 | UTM Phase 1–6 소스·테스트·문서 다수 |
| 최종 verdict | `LIVE_EQUALS_WORKSPACE_WITH_LOCAL_UTM_ARTIFACT` |

즉 **“설치본이 별도 복사본으로 달라진 것”은 아니다.** 라이브 설치는 작업 트리를
그대로 가리킨다. 그러나 **작업 트리 자체가 초기 v0.1.0 패키징 이후 UTM에 의해
수정된 상태**였다. 감사 시점에는 이를 증명할 immutable tarball/artifact나 릴리스
해시가 없었으므로, 이번 작업에서 현재 alpha.2 호환 상태를 `npm pack`으로 고정하고
SHA-256을 기록했다(`.runtime-measure/artifacts/nolit-dsh-sidebar-manager-0.1.1.tgz`,
`8863088d…c74c2`). 이 artifact는 로컬 기준선이며 아직 npm/GitHub 서명 릴리스는 아니다.
UTM 변경의 대표 증거:

- `lib/contract-advisory.mjs`, `lib/workspace-lifecycle.mjs`,
  `lib/promotion-gate.mjs`, `lib/subagent-guard.mjs`, `lib/groups.mjs`,
  `lib/batch-rename.mjs`, `lib/hq-tree.mjs` 등 추가 (mtime 2026-10-24~27)
- `test/advisory-v3.test.mjs`, `test/groups-v2.test.mjs`, `test/phase5.test.mjs` 추가
- `docs/sidebar-manager/PHASE4-*`, `PHASE5-*`, `PHASE6-*` 및 `COMMITS-PENDING.md`
- `package.json` version은 v0.1.0에 머문 채 코드만 앞서 있었고,
  이번 감사에서 v0.1.1로 재기준화함

추가로 **UTM 런타임 상태까지 포함한 재실측**을 수행했다. 라이브
`~/.dsh/storages/workspace.json`과 `~/.dsh/sidebar-manager/groups.json`을
격리 `DSH_HOME`에 읽기 전용으로 복제한 뒤 실제 `dsh web`을 부팅하니:

- `groups/list` → `status: "ok"`, Core 그룹, 9 members
- `groups/view` → `schemaVersion: 3`, HQ 트리와 4개 비차단 관찰 렌더링
- UI → `Core-00-System`, `Core-01-UTM`, `Core-02-HUB`,
  `HUB-01`~`HUB-05`, `Core-99-UROH` 정상 표시

이전 보고서의 기본 상태 라우트 결과(`status:absent`, groups 0)는 UTM 상태를
제외한 격리 home 결과였으므로, 이번 측정으로 대체한다. 감사 스크립트는
`scripts/audit-installed-vs-packaged.mjs`이며 증거는
`.runtime-measure/installed-vs-packaged.json`,
`.runtime-measure/routes-utm-state.json`,
`.runtime-measure/interact-utm-state.json`에 있다.

### 2.4 `@nolit/dsh-notify-web` v0.1.1 (미설치 → 격리 실측 / 라이브 설치 차단)

| 검증 | 결과 |
|---|---|
| 격리 프로필 link + bundle | PASS |
| boot graph 진입 | PASS (`@nolit/dsh-notify-web/client.js`) |
| 동의 오버레이 | `DSH 알림을 켜시겠습니까?` 렌더링 |
| injected packages | `dsh-api-remotes`, `dsh-client-ui-session`, `dsh-client-ui-renderer` 모두 alpha.2에 존재 |
| 콘솔/pageerror | 0건 |
| 단위 테스트 | 19/19 PASS |

환경 제약도 재확인했다. 현재 세션 버스는 살아 있지만
`org.freedesktop.Notifications`가 activatable하지 않아 **OS 네이티브 알림은
전달 불가**이며, 플러그인은 설계대로 화면 토스트와 Web Audio 폴백을 사용한다.
보안 컨텍스트가 아닌 LAN HTTP 접속에서는 브라우저가 권한을 `denied`로
고정하므로 `insecure` 상태 안내 + 토스트 폴백이 정답이다. 실측:
`http://192.168.50.203:3098` → `isSecureContext=false`,
`Notification.permission="denied"`, 플러그인 상태 `permission="insecure"`.
원격 Chrome의 OS 알림은 **접속한 PC의** Chrome/OS 정책을 따르며, DSH 호스트의
알림 데몬은 로컬 브라우저를 띄울 때만 관련된다.

**라이브 설치 상태:** 이 에이전트 샌드박스는 `/`가 `ro`로 마운트되어
`~/.dsh`에 쓸 수 없다(`touch ~/.dsh/.write-test` → `EROFS`). 따라서 라이브
프로필 설치는 실행하지 못했고, 대신 실행 가능한 설치 스크립트
[`scripts/install-notify-live.sh`](../scripts/install-notify-live.sh)를 준비했다.
이 스크립트는 프로필 package/lock/patch를 quarantine에 백업한 뒤
`dsh plugin --profile web add link:<dsh-notify>`를 실행하고, 의존성·bundle
선택을 검증한 다음 재시작/롤백 명령을 출력한다. 격리 프로필에서는 동일한
link+bundle 조합으로 이미 부팅 검증을 마쳤다.

---

## 3. 공식 문서/환경 기준 확인

설치된 `@deepseek-ai/dsh` 0.2.2-alpha.2 패키지의 README와 타입 선언을 기준으로
다음을 확인했다.

- `dsh.manifestVersion: 1` 유지.
- `dsh.bundle.patch`는 문자열 또는 순서 있는 문자열 배열.
- `dsh.client.platform: "web"`, `inject`는 패키지명 의존 edge.
- `engines.dsh`는 SemVer range이며, 런타임은 `includePrerelease`로 검사.
- 앱 부팅은 `engines.dsh`가 있으면 DSH peer 검사보다 우선.
- `dsh.profile.bundles` 순서가 patch layer 우선순위를 결정.
- 클라이언트는 여전히 `window.__ModuleLoader__.load({ id, factory })` CJS factory.

따라서 기존 플러그인 구조(ESM Host half + CJS browser half + bundle patch)는
alpha.2에서도 유효하다. 변경이 필요한 것은 **검증 범위 선언과 사전 스냅샷**이었다.

---

## 4. 변경 파일

| 파일 | 변경 |
|---|---|
| `dsh-korean-locale/data/ko.json` | +117/-8 키, 68 namespaces / 3,019 keys |
| `dsh-korean-locale/data/coverage.json` | alpha.2 추출 기준·패리티 보고서로 교체 |
| `dsh-korean-locale/lib/client.js` | `npm run build`로 재생성 |
| `dsh-korean-locale/package.json` | v0.2.3, engines alpha.2 |
| `dsh-korean-locale/market/index.json` | v0.2.3, engines alpha.2 |
| `dsh-korean-locale/release.manifest.json` | v0.2.3 설명/노트 갱신 |
| `dsh-korean-locale/README*.md`, `NOTICE` | DSH/커버리지 표기 갱신 |
| `dsh-sidebar-manager/package.json` | v0.1.1, engines alpha.2, devDeps alpha.2 |
| `dsh-sidebar-manager/market/index.json` | v0.1.1, engines alpha.2 |
| `dsh-sidebar-manager/test/manifest.test.mjs` | engines window 갱신 |
| `dsh-notify/package.json` | v0.1.1, engines alpha.2, Cordis peer 갱신 |
| `dsh-notify/market/index.json` | v0.1.1, engines alpha.2 |
| `dsh-notify/test/client.test.mjs` | 회귀 테스트 명칭/버전 갱신 |
| `docs/dsh-plugin-runtime-spec.md` | alpha.2 재실측 및 5.3 coverage refresh |
| `docs/plugin-boot-card.md` | 런타임/engines 예시 갱신 |
| `README.md` | 실제 라이브 번들 구성으로 정정 |

---

## 5. 재현 명령

```bash
cd /home/minami/Workspace/projects/dsh-workspace/dsh-plugins

# 단위/계약 검증
(cd dsh-korean-locale && npm run verify)
(cd dsh-sidebar-manager && npm test)
(cd dsh-notify && npm test)

# 격리 실측(라이브 ~/.dsh 무변경)
# .runtime-measure/home 은 이번 실측에서 생성한 격리 DSH_HOME
DSH_HOME="$PWD/.runtime-measure/home" dsh web --no-open --host 127.0.0.1 --port 3099
# 출력된 token URL을 Playwright로 열고 console/pageerror 수집
node .runtime-measure/measure.mjs "<printed-url>" .runtime-measure

# 사이드바 관리자 읽기 전용 라우트
node .runtime-measure/routes.mjs "<printed-url>"

# 라이브 설치본 vs 작업 트리 vs UTM 수정 감사 (읽기 전용)
node scripts/audit-installed-vs-packaged.mjs
```

증거 파일:

- `.runtime-measure/measure-final.json` — 최종 브라우저 부팅 결과
- `.runtime-measure/boot-final.json` — 최종 75-entry boot graph
- `.runtime-measure/routes-final.json` — 라우트 5/5 + 404 대조군
- `.runtime-measure/capture-page.png`, `sidebar-open.png` — UI 스크린샷
- `.runtime-measure/coverage2.json`, `missing-keys.json` — 사전 재추출 결과
- `.runtime-measure/installed-vs-packaged.json` — 설치본/작업 트리/UTM drift 감사
- `.runtime-measure/routes-utm-state.json` — 라이브 UTM 상태를 복제한 라우트 실측
- `.runtime-measure/interact-utm-state.json` — UTM HQ 트리 UI 실측
- `.runtime-measure/npm-pack-sidebar.json`, `.runtime-measure/artifacts/SHA256SUMS` — 로컬 immutable artifact 해시

---

## 6. 남은 최적화 백로그

| 우선순위 | 항목 | 판단 |
|---|---|---|
| P0 | Sidebar manager immutable release 재발행 | 로컬 `.tgz`와 SHA-256은 생성 완료. 아직 npm/GitHub 서명 릴리스에는 고정되지 않았으므로 배포 시 artifact 해시 대조 필요 |
| P1 | 라이브 알림 플러그인 승격 | 링크 설치는 `dsh plugin --profile web add link:<path>` + 재시작. 라이브 프로필 변경은 사용자 명시 승인 후 수행 |
| P1 | Korean optional bundle 확장 | Forge/Liveshare/Stats/CUA/Action Cards/Creation·Plugin Recommendations 등 미활성 번들 사전은 후속 추출 필요 |
| P2 | Sidebar manager rollback 원자성 | `workspace.json` 전체 복원 리스크는 코드 변경 전 별도 승인 필요 |
| P2 | Notify locale 연동 | 현재 설정 UI 문구가 한국어 중심 하드코딩. `locale` 서비스 기반 i18n 후속 |
| P3 | OS 알림 데몬 | 환경에 `org.freedesktop.Notifications` 미설치. 플러그인 문제가 아니며 토스트 폴백 유지 |

## 7. 최종 판정

- **현재 구성 2종**: alpha.2에서 정상 동작. Korean은 누락 키 보강 후 enabled surface 패리티 0.
- **알림 플러그인**: alpha.2 호환 실측 완료. 라이브 미설치 상태는 의도적이며, 승격 준비 완료.
- **문서/매니페스트**: 최신 런타임과 실제 라이브 구성에 맞게 정정 완료.
