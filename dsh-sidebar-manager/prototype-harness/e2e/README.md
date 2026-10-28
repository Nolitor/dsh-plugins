# Sidebar Manager Playwright E2E

> 상태: active · 최종 갱신: 2026-10-23 · 상위: [Sidebar Manager README](../../dsh-sidebar-manager/README.md)

## 인덱스

| 섹션 | 목적 |
|---|---|
| 개요 | 격리된 DSH 인스턴스에서 실제 Web UI를 검증하는 방법 |
| 준비 | fixture·프로필 설치·Playwright 설치 |
| 실행 | E2E 실행과 서버 수명주기 |
| 검증 범위 | 55개 체크와 알려진 제약 |

## 개요

`run-e2e.mjs`는 **사용자 서버(3080)를 건드리지 않고** 별도 `DSH_HOME`과 포트(기본 3099)로
DSH Web을 기동한 뒤 Playwright로 실제 사이드바 UI를 조작합니다. Move/Rename/Fork는
Phase A 실행 후 테스트 서버만 재시작해 boot finalizer까지 검증합니다.

- 실제 프로필/세션을 복사하지 않고 fixture 세션을 생성
- Move/Rename/Fork는 각각 `journal files-ready → 서버 재시작 → committed` 확인
- 실패 시 테스트 서버는 `finally`에서 종료

## 준비

```powershell
cd C:\Users\nolit\Workspace\projects\dsh-workspace
npm install --prefix tools/e2e
```

fixture와 격리 프로필:

```powershell
$env:DSH_E2E_HOME = "$env:TEMP\dsh-e2e-home"
$env:DSH_E2E_ROOT = "$env:TEMP\dsh-e2e-root"

node tools/e2e/prepare-fixture.mjs --home $env:DSH_E2E_HOME --root $env:DSH_E2E_ROOT

$env:DSH_HOME = $env:DSH_E2E_HOME
dsh plugin --profile web add C:\Users\nolit\Workspace\projects\dsh-workspace\dsh-sidebar-manager
```

테스트 프로필 patch에 설정 override를 추가합니다.

```yaml
- id: sidebar-manager
  config:
    projectsRoot: C:/Users/nolit/AppData/Local/Temp/dsh-e2e-root
    allowExternalPaths: false
    trashRetentionDays: 30
```

## 실행

```powershell
$env:DSH_E2E_HOME = "$env:TEMP\dsh-e2e-home"
$env:DSH_E2E_ROOT = "$env:TEMP\dsh-e2e-root"
$env:PLAYWRIGHT_CORE = "C:\Users\nolit\Workspace\projects\dsh-workspace\tools\e2e\node_modules\playwright-core"
node tools/e2e/run-e2e.mjs
```

`run-e2e.mjs`가 테스트 서버를 직접 기동·종료하므로 별도 서버를 미리 띄우지 않습니다.
브라우저는 `%LOCALAPPDATA%\ms-playwright\chromium-1243`을 사용하며,
`DSH_E2E_CHROME`로 경로를 바꿀 수 있습니다.

## 검증 범위

- Phase 1: 상단 3번째 Workspace manager 패널, 인라인 행, 폴더 필드 표시/숨김
- Phase 2: Move 같은 워크스페이스 차단, 기본 워크스페이스 rename 차단,
  Fork 외부 경로 차단, 비아카이브 Purge 차단, Confirmation Gate 비활성/활성,
  타이틀 전용 Enter 즉시 저장 및 Esc draft 복원
- Phase 3: Move → 재시작 → registry/header/UI 그룹 이동
- Phase 4: Workspace Archive/Restore (패널 내)
- Phase 5: 인라인 폴더명 입력 → Gate → 재시작 → path/header 보존
- Phase 6: Fork → 재시작 → 새 워크스페이스 첫 세션
- Phase 7: Archive 후 Purge → registry/log/backup 검증

2026-10-23 실행 결과: **55/55 checks, failed 0** (isolated port 3099).
