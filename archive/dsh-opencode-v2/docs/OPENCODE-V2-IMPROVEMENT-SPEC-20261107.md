# OpenCode v2 improvement spec — 2026-11-07

<!-- skeleton:
version: 1.0
kind: design
status: active
updated: 2026-11-07
summary: Today's next plugin change — canonical recipe parser behind an opt-in seam with a prose-preservation fix; 2.2.6 job/session work is deferred.
-->

## Session result in brief

- The old session measured OpenCode install/compatibility and wrote plans; it shipped no
  plugin efficiency change.
- The matching roadmap is the `deepseek-recipe` track: Tier A is applied; Tier B (canonical
  parser) and Tier C (conformance oracle) are staged, not on the stable path.
- 2.2.6 jobs/session parts do not touch the adapter's HTTP data plane, so they are not an
  immediate speed or token gain.

## Work to apply today

1. Port `canonical-tokens.js`, `protocol-parser.js`, `conformance.js` from
   `staging/opencode-v2-stage2/` into `lib/`.
2. Select the parser with `parser: 'legacy' | 'canonical'`; keep `legacy` as the default
   until the gates pass.
3. Fix prose loss: when a marker appears inside prose and is undeclared/unterminated,
   release the original text verbatim; report at most a `notation` part.
4. Run the conformance corpus and chunk-invariance tests from the shipped suite.
5. Keep rollback to `parser: 'legacy'` for one release.

## Effect

- No more deletion of prose that mentions tool-call notation.
- Complete declared calls still reach the DSH parser; malformed notation is not printed as prose.
- No performance or token gain is claimed until a replay/real-turn gate exists.

## Verification

```bash
cd dsh-opencode-v2 && npm test
node --test ../staging/opencode-v2-stage2/test/conformance.test.mjs
npm run docs:check
```
