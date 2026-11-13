# @nolit/dsh-custom-router

<!-- skeleton:
version: 0.0.1-rc.20
kind: readme
status: active
updated: 2026-11-14
summary: Package entry for @nolit/dsh-custom-router 0.0.1-rc.20 — the single DSH plugin owning the preset registry, the browser dashboard, the OpenCodex bridge library, and four vendored adapters (Antigravity, OpenCode, DeepInfra, EXAONE). Points to the doc index, the specs registry and the compatibility matrix.
-->

> 현재 버전: 0.0.1-rc.20
> 기능 요약: 다중 LLM 프로바이더(Antigravity, OpenCode, DeepInfra, EXAONE)의 프리셋과 라우팅을 통합 관리하는 DSH 엔진 어댑터입니다.
> 상세 설명: [문서 인덱스](docs/INDEX.md)
> 호스트 기준: DSH `0.2.2-rc.3`, Node `v24.22.1` (실측 2026-11-14)

## 프로바이더

네 프로바이더 모두 이 패키지 안에 **vendored** 되어 있습니다 — 별도 프로필 설치가 아닙니다.

| 프리셋 | 벤더 패키지 | 인증 | 모델 |
|---|---|---|---|
| Antigravity | `@nolit/dsh-antigravity` `0.0.1-rc.14` | 웹 로그인 (API 키 경로 없음) | Gemini / Claude |
| OpenCode | `@nolit/dsh-opencode-v2` `0.0.1-rc.8` | 로컬 데몬 | OpenCode Go / Zen |
| DeepInfra | `@nolit/dsh-deepinfra` `0.0.1-rc.14` | API 키 | DeepInfra 카탈로그 |
| EXAONE | `@nolit/dsh-exaone` `0.0.1-rc.1` | API 키 | `k-exaone_v2.5` — 한국어·문과형, 현재 신청 시 무료 |

EXAONE은 **Add provider → EXAONE**에서 활성화한 뒤, 같은 카드의 설정에서 API 키를
입력하면 사용할 수 있습니다(키는 `vendorConfig.dsh-exaone.apiKey`에 write-only로 저장).

## 라이브 규격

- [specs/README.md](specs/README.md) — 프로토콜·프로바이더·가격 레지스트리와 신선도 규칙
- [docs/COMPATIBILITY-MATRIX.md](docs/COMPATIBILITY-MATRIX.md) — specs에서 생성된 호환성 매트릭스
- `npm run spec:watch` — 등록된 공식 문서/체인지로그/가격 URL의 해시 변경과 diff를 수동 확인 (스케줄러 없음)

## 개선 이력
[최신 변경 사항](CHANGELOG.md)
