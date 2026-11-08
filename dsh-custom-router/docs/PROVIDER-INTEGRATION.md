# Custom Router — Antigravity and DeepInfra Provider Integration

<!-- skeleton:
version: 1.0
kind: report
status: active
updated: 2026-11-08
summary: Record of the owner-ordered 2026-11-08 integration: Antigravity and DeepInfra moved from separate profile plugins into the Custom Router vendor tree, their standalone links were removed, and llm-pi-ai was re-enabled.
-->

> **Owner instruction (2026-11-08):** *"커스텀라우터 플러그인 통합으로 인하여 플러그인 중에
> 안티그래비티, 딥인프라 플러그인 삭제 및 관련 서브 프로젝트 해당 플러그인 사용하지 않고
> 커스텀라우터 플러그인으로 통합되었다고 관련 문서 커밋하고, 설정-모델 pi-ai 사용 가능으로
> 활성화해줘"*

## 1. What changed

| Item | Before | After |
| :--- | :--- | :--- |
| `@nolit/dsh-antigravity` | active top-level track, `link:` dependency and profile `node_modules` link | source lives at `dsh-custom-router/vendor/antigravity/`; no separate profile dependency or link |
| `@nolit/dsh-deepinfra` | active top-level track, `link:` dependency and profile `node_modules` link | source lives at `dsh-custom-router/vendor/deepinfra/`; no separate profile dependency or link |
| Router preset package | vendor package specifiers resolved through the profile | internal subpath exports `@nolit/dsh-custom-router/vendor/antigravity` and `.../vendor/deepinfra` |
| `llm-pi-ai` | disabled in the live web profile | enabled again; dormant until a provider profile is saved, so `deepseek-account` remains the default route |
| Browser dashboard | one tab per separately installed vendor | the same one `custom-router` settings section owns provider usage, switches and write-only credentials |

The provider code was **moved, not rewritten**. The Antigravity and DeepInfra unit suites still
run from the vendored directories, and their imports of the shared stream pipe now resolve by
relative path inside `dsh-custom-router` rather than by bare package name.

## 2. Why the integration is safe

1. The router already mounted these packages as child rows; moving the source does not add a
   second adapter registration path.
2. `lib/vendor-modules.js` resolves the vendored bridges from `import.meta.url`; only OpenCode
   still resolves through the profile.
3. The live `vendorConfig` stays keyed by row id (`dsh-antigravity`, `dsh-deepinfra`), so saved
   credentials, model allowlists and per-layer switches keep their names.
4. The profile no longer carries either package as a dependency or `node_modules` link; the
   custom-router loader row is the only owner of those provider surfaces.

## 3. Measured verification

| Check | Result |
| :--- | :--- |
| `npm test --prefix dsh-custom-router` | 332/332 pass |
| Vendored Antigravity suite | 164/164 pass |
| Vendored DeepInfra suite | 205 pass / 7 skip / 0 fail |
| `dsh-custom-router/scripts/verify-mount.mjs` (isolated `DSH_HOME`) | router mount ok; providers `antigravity`, `deepinfra`, `deepinfra-anthropic`, `deepseek-account`, `opencode-http-agent`; 0 "did not activate" |
| `dsh --profile web --dump-config` | `llm-pi-ai` row present without `disabled: true`; no `@nolit/dsh-antigravity` or `@nolit/dsh-deepinfra` profile dependency |

The mount gate's only parity difference was the pre-existing `deepinfra-anthropic` route, which was
already present before this round and is outside the archival change.

## 4. What a future agent must not do

- Do not re-add `@nolit/dsh-antigravity` or `@nolit/dsh-deepinfra` as separate profile packages.
  Two owners of the same provider id produce a hard duplicate-adapter failure.
- Do not move `vendor/` source back to the repository root without also restoring the profile
  links, exports and `vendor-modules.js` resolution.
- Do not treat `llm-pi-ai` as deprecated: the 2026-10-30 policy was superseded by the owner's
  2026-11-08 instruction. It is enabled and available in Settings → Models.

## 5. Related documents

- [CUSTOM-ROUTER-ARCHITECTURE.md](./CUSTOM-ROUTER-ARCHITECTURE.md)
- [PRESET-SCHEMA-AND-EXTENSION.md](./PRESET-SCHEMA-AND-EXTENSION.md)
- [README-OWNERSHIP.md](./README-OWNERSHIP.md)
- [../../docs/DSH-HARNESS-POLICY.md](../../docs/DSH-HARNESS-POLICY.md)
