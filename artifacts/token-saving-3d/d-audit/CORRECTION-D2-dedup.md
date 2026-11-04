# Correction to the iceman audit's claim 3 (dedup)

The re-dispatched iceman auditor's final run now reproduces the tiering numbers (229 rewrites,
982,680 net chars, 0 inflating, 1 prune-marker original) but reports **dedup pointers 0** and calls
claim 3 WRONG. That verdict is itself wrong: the detector looked for replacement-shaped events
only and missed the `surfaceOp: "append"` form.

Independently verified by the Lead over ~/.dsh/sessions (window 1793571849158-1793831049158):
4 tool/result events whose text BEGINS with the TE pointer, all with `surfaceOp: "append"`:

| session | seq | time (UTC) | pointer chars |
|---|---|---|---|
| session-70ee2d8d | 619 | 2026-11-03T12:35:20Z | 83 |
| session-70ee2d8d | 1771 | 2026-11-03T12:48:39Z | 84 |
| session-edeabe91 | 1882 | 2026-11-01T23:18:07Z | 83 |
| session-f62f7f28 | 4587 | 2026-11-04T21:44:19Z | 83 |

Original duplicate sizes recovered by SHA-256 hash match (Track A): 3,102 / 203 / 549 / 246 chars.
Net dedup saving 3,767 chars; Track B's mirror-vs-raw cross-check finds 4/4 pointers on both
stores (0.00% divergence).

Verdict: claim 3 is CONFIRMED (4 pointers, append shape). The rest of this audit (claims 1, 2, 4,
5) matches the authoritative numbers. See `lead-audit.md` and `report-trackA.*`.