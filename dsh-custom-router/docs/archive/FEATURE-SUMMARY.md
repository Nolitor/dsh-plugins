# @nolit/dsh-custom-router — 기능 개요 및 개선 이력

<!-- skeleton:
version: 1.1
kind: index
status: archived
updated: 2026-11-14
summary: Historical feature summary; current state is HANDOFF/README/CHANGELOG and active work is ROADMAP.md. Version rows below stop at the versions they record and are not the current baseline.
-->

> **HISTORICAL SUMMARY (2026-11-14).** 이 문서는 이력 기록입니다. 현재 기준값과 다음 작업은
> [HANDOFF.md](../HANDOFF.md) · [ROADMAP.md](../ROADMAP.md) · [README](../../README.md) ·
> [CHANGELOG](../../CHANGELOG.md)를 보십시오. 아래 표의 버전/테스트 수치는 **그 버전 당시의 값**이며
> 현재 기준값이 아닙니다.

**현재 기준값 (실측 2026-11-14):** `@nolit/dsh-custom-router@0.0.1-rc.19`, 호스트 DSH `0.2.2-rc.3`,
Node `v24.22.1`. 테스트: 라우터 **625/625**, antigravity 190/190, deepinfra 217 pass / 7 skip,
opencode 554/554, exaone 14/14.

## 1. 기능 설명
다양한 LLM 프로바이더(Antigravity, OpenCode, DeepInfra, EXAONE)의 프로토콜을 DSH 표준
프리셋으로 통합하여 단일 진입점으로 관리합니다. 네 어댑터는 모두 이 패키지 안에 vendored
되어 있으며 별도 프로필 설치가 아닙니다.

- **프로바이더 통합**: 벤더드 어댑터를 통한 호환성 보장
- **프리셋 검증**: Drift Gate를 통한 설정 무결성 확인
- **모델 목록 갱신**: 캐시 우회 기반 동적 갱신 지원
- **공유 스트림 파이프**: `lib/stream/`이 모든 프로바이더를 정규화

## 2. 버전별 개선 사항 (각 버전 당시 값 — 현재 기준값 아님)

| 버전 | 주요 개선 사항 | 그 당시 실측 지표 |
|---|---|---|
| **0.0.1-rc.17** | google-generative-ai 와이어 프로토콜 추가 및 스키마 enum 파생화 | verify:presets 통과, 535 테스트 패스 |
| **0.0.1-rc.16** | 단일 관리 경로 통합 및 레거시 관리 폐기 | - |
| **0.0.1-rc.15** | 프리셋 레지스트리 Drift Gate 구축 | 17/17 변이 테스트 패스 |

> 이후 버전(rc.18, rc.19)의 변경 내역과 활성 작업은 [../CHANGELOG.md](../../CHANGELOG.md)와
> [ROADMAP.md](../ROADMAP.md)에 있습니다. 이 표는 더 이상 갱신하지 않습니다.

## 3. 참고

- 현재 상태: [HANDOFF.md](../HANDOFF.md)
- 활성 작업: [ROADMAP.md](../ROADMAP.md) · 종료된 계획: [ROADMAP-ARCHIVE.md](../ROADMAP-ARCHIVE.md)
- 변경 이력: [../CHANGELOG.md](../../CHANGELOG.md)
