# Shared host documents — pointer block

<!-- skeleton:
version: 1.0
kind: reference
status: active
updated: 2026-11-06
summary: Managed pointer block for per-agent AGENTS.md files so any CLI agent finds the host-wide docs at /home/minami/Workspace/projects/docs.
-->

This block is meant to be **inserted into each agent's own rules file**, between the managed
markers so it can be updated idempotently:

```
<!-- >>> shared-docs pointer (managed) >>> -->
**Host-wide documents (required)**: rules that apply to every project on this machine live at
`/home/minami/Workspace/projects/docs/`. Read `README.md` there before acting on a host-level subsystem.
- Browser work (text/data collection): `lpd` / `ws://127.0.0.1:9333` — full rule at
  `/home/minami/Workspace/projects/docs/HOST-BROWSER-POLICY.md`
- SSOT for the browser daemon: `/home/minami/.local/share/lpd/AGENTS_GUIDE.md`
<!-- <<< shared-docs pointer (managed) <<< -->
```

## Where to install it

| Agent | Rules file | Notes |
|---|---|---|
| DSH | `~/.dsh/AGENTS.md` | already has a `lightpanda-cdp rule (managed)` block — **extend that block rather than adding a second one**, or two blocks will drift |
| OpenCode | `~/.config/opencode/AGENTS.md` | currently a **symlink** to `~/.local/share/lpd/AGENTS_GUIDE.md`; replacing it with a file breaks that link's original purpose — prefer appending the pointer to the SSOT itself |
| Antigravity | `~/.antigravity/` | add an `AGENTS.md` there if the CLI supports one |
| Hermes | `~/.hermes/` | same |
| Claude Code / Codex | `~/.claude/`, `~/.codex/` | not present on this machine yet |

The installer in `install.sh` handles DSH and OpenCode and reports the rest as manual.
