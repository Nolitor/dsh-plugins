# Sidebar Manager 최종 완료 보고서

<!-- skeleton:
version: 1.0
kind: report
status: completed
updated: 2026-10-29
summary: Closing report for the Sidebar Manager programme: delivered surfaces, measured state, and the work left open.
-->


> 상태: completed · 최종 갱신: 2026-10-23 · git: main @ f277d50 · 상위: `dsh-workspace` (`AGENTS.md` in the `dsh-plugins` workspace)

## P3 후속 (2026-10-23)

- Workspace Manager를 footer에서 **상단 3번째 `sidebar.panellist` + `main` 패널**로 승격.
- 행별 인라인 이름 편집, 폴더 포함 체크, 인라인 새 디렉토리명, 이름 변경/보관 2버튼 구현.
- 타이틀 전용은 Enter 즉시 저장, 실제 디렉토리 변경만 Confirmation Gate.
- E2E **55/55 checks** 통과. 상세: [Sidebar Manager README](../../README.md)

## 인덱스

| 섹션 | 목적 |
|---|---|
| 결론 | 현재 완료 상태와 재시작 필요 여부 |
| 실서버 설치 | 3080 web 프로필의 패치·링크 설치 내역 |
| 실기동 검증 | Playwright E2E 55/55 및 재시작 finalizer 결과 |
| 구현 요약 | P2 Host 트랜잭션과 Fork 방식 |
| 재시작 후 확인 | 실제 UI에서 확인할 항목 |
| 롤백 | 설치·트랜잭션 복구 절차 |
| 남은 제약 | 실서버 UI 미검증 등 |

## 결론

- **실서버(3080) web 프로필에 A안 설치 완료**: link dependency + bundle + config override.
- **격리 DSH(3099)에서 Playwright E2E 55/55 통과** (P3 panel UI). Move/Rename/Fork는 실제 서버 재시작 후 boot finalizer까지 검증.
- 현재 3080 서버는 **재시작 전**이라 기존 프로세스에는 플러그인이 아직 로드되지 않았다. 재시작하면 사이드바에 적용된다.
- 실서버의 실제 세션 데이터는 E2E에서 사용하지 않았다. E2E는 `%TEMP%\dsh-e2e-home`의 별도 fixture만 사용했다.

## 실서버 설치

프로필: `C:\Users\nolit\.dsh\profiles\web`

`package.json`:

```json
"dependencies": {
  "@nolit/dsh-sidebar-manager": "link:C:/Users/nolit/Workspace/projects/dsh-workspace/dsh-sidebar-manager"
},
"dsh": {
  "profile": {
    "bundles": [
      "@deepseek-ai/dsh-base",
      "@deepseek-ai/dsh-web-app",
      "@deepseek-ai/dsh-experimental-agent-team-profile",
      "@nolit/dsh-sidebar-manager"
    ]
  }
}
```

`cordis.patch.yml` 추가분:

```yaml
# Sidebar Manager live config (A install; restart required)
- id: sidebar-manager
  config:
    projectsRoot: C:/Users/nolit/Workspace/projects
    allowExternalPaths: false
    trashRetentionDays: 30
```

- 링크 확인: `profiles/web/node_modules/@nolit/dsh-sidebar-manager` → 로컬 패키지 junction
- 구성 확인: `dsh --profile web --dump-config`에 `sidebar-manager`와 config 3개 값 표시
- 백업:
  - `package.json.bak-e2einstall-20261023-000004`
  - `cordis.patch.yml.bak-e2einstall-20261023-000004`

## 실기동 검증

Playwright 하네스: `prototype-harness/e2e/run-e2e.mjs` in the `dsh-plugins` workspace

- 격리 `DSH_HOME=%TEMP%\dsh-e2e-home`, 포트 **3099**
- fixture workspace: E2E Alpha/Beta/Gamma/Delta
- Move → 재시작 → Move finalizer
- Rename folder → 재시작 → Rename finalizer
- Fork → 재시작 → Fork finalizer
- Archive/Restore, Purge, 실패 가드

결과: **55 checks, failed 0**.

추가 회귀:

| 검증 | 결과 |
|---|---|
| P2 host smoke | 19/19 |
| P0b workspace rename spike | 79/79 |
| I18N key parity (ko/en) | 77/77 |
| `node --check` (Host/Client/E2E) | 통과 |

## 구현 요약

- Exact Fetch routes: preview 3종 + purge/archive/restore/archived/move/rename-folder/fork
- 파일 트랜잭션: `~/.dsh/backup/<txid>/`, `~/.dsh/sidebar-manager/journal/pending.json`
- Move/Rename/Fork는 Phase A에서 파일만 준비하고 `restartRequired` 반환
- 다음 기동 시 `apply()`의 boot finalizer가 `prepared` 롤백 또는 `files-ready` 완료
- Fork는 `sessionController.fork`의 live 자식 문제를 피하기 위해 **원본 로그를 새 세션 ID로 복제**
- Workspace Archive/Restore 상태: `~/.dsh/sidebar-manager/state.json`

## 재시작 후 확인

1. 사이드바 상단 3번째 **Workspace manager** 메뉴 표시
2. 세션 hover 시 **Permanently delete session** 휴지통 표시
3. 세션 `⋯` 메뉴에 `Move to workspace…`, `Fork to new workspace…`, `Delete permanently…` 표시
4. Move/Fork/Rename 다이얼로그에서 영향 세션 수·경로·재시작 경고·확인 체크 표시
5. 실제 작업은 테스트용 Cold 세션/워크스페이스로 먼저 수행

## 롤백

설치 롤백:

```powershell
$p = "$env:USERPROFILE\.dsh\profiles\web"
dsh plugin --profile web remove @nolit/dsh-sidebar-manager
Copy-Item "$p\package.json.bak-e2einstall-20261023-000004" "$p\package.json" -Force
Copy-Item "$p\cordis.patch.yml.bak-e2einstall-20261023-000004" "$p\cordis.patch.yml" -Force
```

트랜잭션 롤백: DSH 종료 후 `~/.dsh/backup/<txid>/`의 workspace/session/projcache 스냅샷을 복원하고,
`~/.dsh/sidebar-manager/journal/pending.json` 상태를 확인한다. `files-ready` journal은 임의 삭제하지 않는다.

## 남은 제약

- 3080 실서버 재시작 전이므로 실제 화면의 최종 육안 확인은 아직 남아 있다.
- 실서버 데이터에 대한 Move/Rename/Fork/Purge는 수행하지 않았다.
- E2E는 테스트 fixture에 한정되며, 실제 프로젝트 경로·세션 권한 조합은 재시작 후 확인이 필요하다.
