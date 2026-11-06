# projects/docs — host-wide shared documentation

<!-- skeleton:
version: 1.0
kind: index
status: active
updated: 2026-11-06
summary: Host-wide documents every agent on this machine must be able to find, above any single project. Not owned by any one repo.
-->

> **Location:** `/home/minami/Workspace/projects/docs/` — the **top-level projects directory**,
> beside every project and above `dsh-workspace/`. **Scope:** host-wide. Every CLI agent (DSH, OpenCode, Antigravity, Hermes, Claude Code, Codex)
> can read these files regardless of which project it was started in.

## Why this directory exists

A document that governs **every** agent on the machine has no correct home inside a single project.
Filing it in one project's `docs/` makes every other agent either duplicate it or lose it. This
directory sits above the project tree so the rule has one address that outlives any one repo.

Precedence:

```
~/.dsh/AGENTS.md            global harness rules   (auto-loaded, wins over everything)
  -> projects/docs/         host-wide policies     (this directory — cross-project facts)
     -> <project>/docs/     project rules          (that project only)
```

## Documents

| Document | What it settles |
|---|---|
| [HOST-BROWSER-POLICY.md](HOST-BROWSER-POLICY.md) | Which browser to use for what: Lightpanda `127.0.0.1:9333` for text/data, Chromium only for click and render verification. Deployed, not proposed. |

## Rules for this directory

- **Only host-wide facts belong here.** If a document is about one project, it goes in that
  project's `docs/`. The test: *would an agent working in a different project need this?*
- **Every document needs a skeleton header** (`version / kind / status / updated / summary`).
- **Name the runtime SSOT.** A policy here is the human-readable layer; if a live config file is
  the real authority, link it explicitly (as `HOST-BROWSER-POLICY.md` does).
- **Do not fork a policy into a project.** A project that needs a strict subset links here; it does
  not copy the text. Two copies diverge and the older one wins in someone's context window.
