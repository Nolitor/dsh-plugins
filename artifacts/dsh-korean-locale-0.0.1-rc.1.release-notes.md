<!-- GitHub release body for Nolitor/dsh-korean-locale v0.0.1-rc.1. English is the default; the Korean section follows. -->

## Read this first: the version number went **down**, on purpose

This release is `0.0.1-rc.1`. The previous release on this repository was `v0.2.4`.
**No work was undone.** The `@nolit` version ladder was reset by owner decision on 2026-11-05.

Every `@nolit` package moved to one scheme, **`0.0.1-rc.N`**, in which only the `rc#` moves.
`0.2.5` is not a milestone under that scheme — the scheme replaced it. The numbers are not
comparable across the boundary.

| Surface | Before | After |
| :--- | :--- | :--- |
| Version scheme | per-track (`0.2.0 → 0.2.1 → … → 0.2.5`) | **`0.0.1-rc.N`** |
| Version | `0.2.5` | **`0.0.1-rc.1`** |

---

## What changed since `v0.2.4`

### Regenerated against DSH `0.2.2-rc.1` — not renamed from the alpha snapshot

The pack was **regenerated** from the rc.1 dictionaries, not carried over from alpha.3.

| Surface | Before (alpha.3) | After (rc.1) |
| :--- | ---: | ---: |
| Namespaces | 69 | **74** |
| Keys | 3,088 | **3,843** |
| New rc.1 namespaces translated | — | `stats` 177, `liveshare` 225, `forgePanel` 253, `creationRecommendations` 55, `pluginRecommendations` 25, `actionCards` 14, `contextMenu` 1 |
| Existing keys added | — | 76 (schedule catalog/manager host copy) |
| Retired keys removed | — | 66 |
| Retired namespaces removed | — | `claude-code-mods`, `deepseek-model-label-1017` (no rc.1 registrations) |

Verified against the installed runtime: **74 namespaces / 3,843 keys, 0 missing, 0 extra,
0 placeholder mismatches**. Every Korean value carries exactly the `{placeholders}` of its
rc.1 English source.

### Terminology: 작업 공간

The workspace term was unified to **작업 공간** across the pack, matching the alpha.3 dictionary
coverage.

### Engine floors raised to the rc.1 minimum

`engines.node` `>=24` → **`>=24.9`**. Registration is unchanged: `addLanguage({id, label,
fallback})` plus per-locale `register`, with `ko` selectable under `fallback: "en"`.

### Release metadata corrected

`release.manifest.json` still described the alpha.2 snapshot (68 dictionaries / 3,019 strings)
and carried the v0.2.4 release notes. Both now describe this release.

---

## Install

```bash
dsh plugin --profile web add @nolit/dsh-korean-locale
```

DSH `0.2.2-rc.1` ships no built-in `ko` (de/en/es/fr/ja/pt/ru/zh). Select Korean in
Settings → Language after installing.

**npm:** `@nolit/dsh-korean-locale@0.0.1-rc.1` · dist-tags `rc` and `latest`
**Verify:** `npm run verify` → 74 namespaces, 3,843 keys, metadata + apply contract +
typography + stand-down guard pass

## Assets

No binary asset. The package is distributed through npm.

---

## 한국어

## 먼저 읽어주세요: 버전 숫자가 **내려간** 이유

이 릴리스는 `0.0.1-rc.1`입니다. 직전 릴리스는 `v0.2.4`였습니다.
**작업이 되돌려진 것이 아닙니다.** 2026-11-05 소유자 결정으로 `@nolit` 버전 사다리가
재설정됐습니다.

모든 `@nolit` 패키지가 **`0.0.1-rc.N`** 한 체계로 통일됐고, **`rc#`만 올라갑니다.**
`0.2.5`는 새 체계에서 마일스톤이 아니며, 새 체계가 이를 대체했습니다. 경계를 넘어 숫자를
비교할 수는 없습니다.

| 표면 | 이전 | 이후 |
| :--- | :--- | :--- |
| 버전 체계 | 트랙마다 제각각 (`0.2.0 → 0.2.1 → … → 0.2.5`) | **`0.0.1-rc.N`** |
| 버전 | `0.2.5` | **`0.0.1-rc.1`** |

## `v0.2.4` 이후 달라진 것

### DSH `0.2.2-rc.1` 기준 **재생성** — alpha 스냅샷 이름만 바꾼 것이 아닙니다

| 표면 | 이전 (alpha.3) | 이후 (rc.1) |
| :--- | ---: | ---: |
| 네임스페이스 | 69 | **74** |
| 키 | 3,088 | **3,843** |
| 신규 rc.1 네임스페이스 번역 | — | `stats` 177, `liveshare` 225, `forgePanel` 253, `creationRecommendations` 55, `pluginRecommendations` 25, `actionCards` 14, `contextMenu` 1 |
| 기존 키 추가 | — | 76 (스케줄 카탈로그/매니저 호스트 문구) |
| 폐기 키 제거 | — | 66 |
| 폐기 네임스페이스 제거 | — | `claude-code-mods`, `deepseek-model-label-1017` (rc.1 등록 없음) |

설치된 런타임 기준 검증: **74개 네임스페이스 / 3,843개 키, 누락 0, 초과 0, 플레이스홀더
불일치 0**. 모든 한국어 값이 rc.1 영어 원문과 정확히 같은 `{placeholder}`를 갖습니다.

### 용어 통일: 작업 공간

작업 공간을 가리키는 용어를 **작업 공간**으로 통일했습니다(alpha.3 사전 범위 기준).

### 엔진 하한을 rc.1 최소값으로 상향

`engines.node` `>=24` → **`>=24.9`**. 등록 방식은 그대로입니다:
`addLanguage({id, label, fallback})` + 로케일별 `register`, `ko`는 `fallback: "en"`으로 선택.

### 릴리스 메타데이터 정정

`release.manifest.json`이 아직 alpha.2 스냅샷(68개 사전 / 3,019개 문자열)과 v0.2.4 릴리스
노트를 담고 있었습니다. 둘 다 이번 릴리스 내용으로 고쳤습니다.

## 설치

```bash
dsh plugin --profile web add @nolit/dsh-korean-locale
```

DSH `0.2.2-rc.1`에는 `ko`가 내장되어 있지 않습니다(de/en/es/fr/ja/pt/ru/zh). 설치 후
설정 → 언어에서 한국어를 선택하십시오.

**npm:** `@nolit/dsh-korean-locale@0.0.1-rc.1` · dist-tag `rc`, `latest`
**검증:** `npm run verify` → 74 네임스페이스 / 3,843 키, 메타데이터·적용 계약·타이포그래피·
스탠드다운 가드 통과

## 자산

바이너리 자산 없음. 패키지는 npm으로 배포됩니다.
