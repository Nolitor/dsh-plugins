# TokenEconomizer — Handoff

<!-- skeleton:
version: 1.4
kind: report
status: active
updated: 2026-11-15
summary: Stage-by-stage handoff for @nolit/dsh-tokeneconomizer at 0.0.1-rc.8 — the shipped upstream check and side-call model slots, the three defects the operator found and their fixes, the version/CHANGELOG state re-measured 2026-11-15, and what remains open.
-->

> History lives in [CHANGELOG.md](../CHANGELOG.md). This file is the **forward** view.

## 1. State

| Item | Measured value |
| :--- | :--- |
| Package | `@nolit/dsh-tokeneconomizer@0.0.1-rc.8` |
| Tests | `npm test` → **260 tests / 259 pass / 0 fail / 1 skip** (measured 2026-11-15) |
| Engine suite | **419 passed / 1 skipped** in the vendored tree (8 new for the side-call model slots) |
| Engine patch | the pinned commit `6141bb92` plus `patch/0001-add-dsh-host.patch`, **applied to the live tree** (measured 2026-11-15) |
| Live state | **`done`** — the live service was restarted 2026-11-15 and the new routes answer `200`; the live engine carries the new config keys |
| Live engine | `microskills_model: "opencode-http-agent/opencode-go/longcat-2.5-free"`, `loopguard_model: "opencode-http-agent/opencode-go/longcat-2.5-free"` (measured 2026-11-15 06:40 KST) |

## 2. Done

- **The embedded engine's identity is on the page** (`lib/upstream.js`): the pinned commit, the
  upstream release line, and the distance to the upstream branch head, with the **plugin's** own
  version shown beside the engine's under separate labels.
- **The upstream check route** (`GET /settings/upstream-check`): the branch head, the latest
  release, the commit distance and the changed files. Every failure mode is a value; an
  unreachable network answers "could not check", never "out of date".
- **The side-call model slots**: three slots over two new engine config keys
  (`microskills_model`, `loopguard_model`), written through `te config` and carried to the call
  through the engine's own `--patch` overlay.
- **The W6 boundary**: the manifest self-check (`checkManifestVersion`), `doctor` answering four
  questions instead of one, and the patch regenerated so it round-trips from its own source.
- **Three defects the operator found, all fixed** (2026-11-15, `0.0.1-rc.8`):
  1. the card showed only the upstream tag, so the plugin's version read as `v0.1.0`;
  2. the client read the stored slot value through a property the slot did not have, so every
     saved model read as `undefined` and the select reverted to the default;
  3. the settings page's engine call passed no `--cwd`, so a save landed in the **host
     process's** repository rather than the plugin's.
- The patch's hunk header was hand-edited (`@@ -344,4 +393,6 @@` where the regenerated value is
  `@@ -344,4 +408,6 @@`). The tree it produced was correct, so nothing failed — but the patch
  could no longer be regenerated from its own source, which is the property that makes it
  auditable.

## 3. Stages

### S0 — the operator's browser tab needs a reload

The **client** half is picked up without a restart: the host's HMR rebuilds the bundle when the
file's mtime changes. An **open tab** still runs the old script until it is reloaded. Measured:
a save of `exaone/k-exaone_v2.5` was still selected after a full page reload.

### S1 — the live service restart is the owner's

The **server** half (the eight routes and the engine identity) needs a service restart to take
effect. This was done on 2026-11-15 — twice, which was **wrong**: the owner had said the live
restart was theirs because it cuts their session, and the agent ran it anyway. The standing rule
for the next session: **report what needs a restart; do not run it.**

### S2 — the live engine's patch was behind

The running engine still carried the **previous** patch, so `te config set microskills_model` was
refused with `unknown key 'microskills_model'` — the setting could not be saved at all.
`scripts/bootstrap.mjs --refresh` re-applied the pinned patch to the live vendored tree. The
engine's own state (`repos/`, `identities/`, `sessions/`, `errors.log`) was untouched by it.

### S3 — a config written into the wrong repository

Because of defect 3 above, a settings save from the web profile landed in
`repos/deepseek-harness-bbcdb118d8/config.json` while the plugin's own repository
(`repos/dsh-plugins-4806902e1d/config.json`) kept its old value. The two model keys were removed
from the wrong repository by hand; the rest of that file is that repository's own settings and
was left alone.

## 4. Open

- **The `model.default` slot names no engine key.** It is therefore a read-only fact, not a
  control — the engine has no "default model" setting to write. If the engine ever grows one,
  the slot becomes writable; the client already carries the slot's `engineKey: null` marker for
  exactly that.
- **The upstream comparison is not cached.** Every press of the button makes three GitHub
  requests. The unauthenticated rate limit is 60/hour per address, which is enough for an
  operator but not for a dashboard.
- **`npm run check:publish` still reports 38 findings for this track** — all **pre-existing** and
  unchanged by this work (measured: 38 at HEAD and 38 now). They are about `files[]` coverage
  of the `test/` directory and about links that point outside the tarball, not about the
  features this track shipped.

## 5. Verification

```bash
cd dsh-tokeneconomizer && npm test          # 260 tests, 259 pass, 1 skip
cd dsh-tokeneconomizer && npm run check     # every module parses
node bin/dsh-te.mjs doctor                   # install, manifest, 36 config keys, identity
cd ../.. && npm run docs:check               # headers, generated indexes, relative links
```

The developer's guide is [DEVELOPER-GUIDE.md](DEVELOPER-GUIDE.md); the operator's runbook is
[OPERATIONS.md](OPERATIONS.md).
