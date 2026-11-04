# INVALID — iceman audit outputs (do not cite)

Files in `failed-iceman-scan/` were produced by the re-dispatched free-model auditor
(Iceman Contributor Free) at 2026-11-05 07:48 and 07:51 KST. Both runs report 0 rewrites.

Evidence the scans were broken:
- run 1: `allToolResults: 230`; run 2: `allToolResults: 289`
- the window actually contains 5,064 tool/result events (16 sessions, 107 idle session dirs seen)
- both runs report `replacementsInWindow: 0`, while the harness logs and the engine mirror
  independently measure 229 TE warm rewrites / 982,680 net chars in the same window
- the scripts stringify `data.message` instead of reading `data.message.content[].text`, so the
  replacement text is never classified

Authoritative audit: `lead-audit.md` (Lead's two-path recomputation) and `report-trackA.*`
(Track A's independent audit, 16/16 claims CONFIRMED).