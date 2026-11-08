# Sidebar Manager (한국어)

<!-- skeleton:
version: 1.0
kind: readme
status: reference
updated: 2026-11-08
summary: Korean translation of the Sidebar Manager operator entry; kept for parity with README.md.
-->


> 상태: active (P3 panel UI) · 최종 갱신: 2026-10-23 · Repository: [linuxsung/dsh-sidebar-manager](https://github.com/linuxsung/dsh-sidebar-manager)

## 인덱스

| 섹션 | 목적 |
|---|---|
| 개요 | 기능 요약 |
| 구현 상태 | P1 UI / P2 Host / P3 panel |
| 안전 규칙 | 트랜잭션 원칙 |

## 구현 상태

- **P1 Client UI 완료** — hover 휴지통, `⋯` 메뉴, Confirmation Gate 구현.
- **P2 Host 완료** — preview 3종 + purge/archive/restore/archived/move/rename-folder/fork, journal·boot finalizer 구현.
- **P3 Manager Panel 완료** — 상단 세 번째 메뉴, 행별 인라인 이름 편집, 폴더 포함 체크, 이름 변경/보관 2버튼, 폴더 변경 Gate. footer 버튼 제거.
- **실기동 E2E 통과** — 격리 DSH(port 3099) Playwright **55/55 checks**. Move/Rename/Fork는 실제 재시작 후 finalizer까지 검증.

## 개요

- 아카이브된 Cold 세션 **영구 삭제**
- **워크스페이스 아카이브/복원** (상단 Workspace manager 패널)
- **Move to Workspace** (zstd 헤더 CWD 재작성 + 레지스트리 2PC)
- **Fork to New Workspace** (원본 로그를 새 ID로 복제해 live 자식 없이 배치)

## 안전 규칙

- Cold 세션만 이동/삭제합니다.
- Fork는 라이브 자식 세션을 만들지 않고 원본 로그를 새 ID로 복제합니다.
- 원본은 `~/.dsh/backup/`에 스냅샷 후 작업합니다.
- 무결성 검증 전에는 구 경로를 지우지 않습니다.
- CWD 변경을 확인 다이얼로그에서 고지합니다.

## 위험 작업 확인 게이트

Move · Fork · 폴더 연동 Rename 실행 전 다이얼로그에서 아래를 **먼저** 표시합니다.

1. 영향 세션 수 + 기존 경로 → 새 경로 + 워크스페이스 제목
2. 에이전트 CWD가 새 경로로 바뀐다는 경고
3. 재시작 후에만 반영된다는 사전 안내
4. `[ ] 위 내용을 확인했습니다` 체크(필수)

체크 전·live 세션 존재·기본 워크스페이스 폴더 변경·경로 충돌 시 **실행 버튼 비활성화**.
`preflight.preview`는 파일을 쓰지 않고 `affectedSessionCount`, `liveSessionCount`,
`oldPath`, `newPath`, `isDefaultWorkspace`, `blockers`를 반환합니다.

## UI 스타일 (design tokens)

UI는 인라인 style 객체가 아니라 **하나의 스코프된 스타일시트**로 그립니다. `lib/client.js`의 `CSS`
배열이 `<style data-plugin-css="@nolit/dsh-sidebar-manager">` 태그 하나로 주입됩니다.

- 모든 규칙은 `.sm*` 클래스만 타깃으로 삼고, 요소 셀렉터가 없습니다.
- 색상은 전부 `--dsw-*` 토큰이며 리터럴 hex 값이 없습니다. 테두리는 `.5px` 헤어라인입니다.
- 글자 크기는 `--dsh-content-font-size` / `--dsh-content-font-size-secondary` /
  `--dsh-content-font-delta` 토큰으로만 표기합니다. 페이지 제목은
  `calc(20px + var(--dsh-content-font-delta,0px))`, 섹션 제목은
  `calc(18px + var(--dsh-content-font-delta,0px))` / `font-weight: 600`입니다.
- 카드는 `--dsw-alias-settings-card-fill` / `--dsw-alias-settings-card-stroke` +
  `var(--dsw-radius-lg)`, 목록 행은 `min-height: 36px` + `var(--dsw-radius-md)`.
- 페이지 폭은 `max-width: 960px`로 가운데 정렬하고 640px 이하에서 반응형으로 접힙니다.
- 모든 조작 요소에 `:focus-visible` 링이 있고, hover/선택 상태는 `@media (hover:hover)` 안에서만
  켜집니다. `prefers-reduced-motion: reduce`이면 이 표면의 transition이 제거됩니다.

## UI 문구(i18n)

모든 사용자 노출 문구는 **[lib/client.js](<lib/client.js>) 상단의 `I18N = { ko, en }` 객체 하나**에만 둡니다.
본문 코드에는 문구를 하드코딩하지 않으며, `navigator.language`가 `ko*`이면 한국어, 아니면 영어가 자동 선택됩니다.
`{count}`, `{oldPath}`, `{newPath}` 자리표시자는 `t(key, vars)`로 치환됩니다.
