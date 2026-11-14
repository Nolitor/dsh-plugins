# DSH schema gap brief — 2026-11-14

<!-- skeleton:
version: 1.0
kind: report
status: active
updated: 2026-11-14
summary: Exhaustive ingestion of the installed DSH 0.2.2-rc.3 core schema and extension contracts across project identity, session/subagent shapes and surfaceOp, and upstream drift resilience, with a severity-ranked gap register and hard-assumption inventory.
-->

## 1. Purpose and method

This brief is the **sole input to Stage 2 (architecture design)**. Stage 2 is forbidden from opening the
repository, so every fact it needs about the DSH core schema, the extension seams the plugin uses, and the
way upstream DSH drifts under the plugin must live here. This document is therefore written to **stand
alone**: it carries the contract text, not a pointer to it.

### 1.1 Why this brief exists

The Lead's earlier audit of the TokenEconomizer bridge was **locally biased**: it checked a subset of
fields against the *running* installation and against the plugin's own view of itself. Three things were
missed by that method.

1. **Local bias.** A field that exists in the running runtime but is not declared in a published
   `.d.ts` looks identical to a field that does not exist at all. The plugin cannot see the difference,
   because it is plain JavaScript with no typecheck step (`G-C-02`). Only a separate reader that
   inspects the *published type declarations* can tell the two apart.
2. **One dimension at a time.** Project identity, session/subagent shapes, and upstream drift are three
   separate axes. A gap that is invisible in one axis is fatal in another — for example, a project key
   that is stable in isolation but never persisted alongside the data it keys is not a stable key.
3. **No assumption inventory.** The plugin's assumptions were never enumerated as a countable,
   reviewable set, so nobody could tell how many of them are *silent*.

This brief fixes all three by ingesting each dimension exhaustively and registering every divergence as a
numbered gap.

### 1.2 Method

Three parallel ingestion workers, one per dimension, each reading the installed DSH and the installed
plugin with **grep-first, narrow-window** discipline (no whole-file reads of the plugin's 1396-line
`lib/index.js`):

| Fragment | Dimension | Scope |
|---|---|---|
| **A** — project | Project / workspace isolation & identifiers | DSH project identity, the session-store slug algorithm, the workspace metadata store, service scoping keys, the plugin's engine repo key, and the divergence between them |
| **B** — session | Extended session & subagent schemas | `HeaderLine` / `SessionHeader`, discriminator semantics, agent role / preset / lineage, the session event catalog, the `surfaceOp` append contract, lifecycle hook signatures, the public vs internal Agent/Session surface, and real-log grounding |
| **C** — drift | Upstream drift resilience | Seam stability tiers, capability-seam discovery, the manifest/version assertion surface, DSH's own degradation mechanisms, the hard-assumption inventory, the deprecation process, and drift-defense constraints |

**Evidence tiers.** Every claim in this brief is ranked by the strength of the evidence behind it, and
the tiers are used consistently:

| Tier | What it means | Weight |
|---|---|---|
| **T1 — typed declaration** | A published `.d.ts` in the installed DSH, or a runtime-verbatim contract text | Authoritative. This is what the plugin is *contracted* against. |
| **T2 — readable source** | Readable `.js` / `.ts` source in the installed DSH | Authoritative for runtime behaviour where no `.d.ts` exists. |
| **T3 — real session log** | An actual `session.v4.jsonl.zstd` from the live corpus | Authoritative for what *happens*; weaker for what is *guaranteed*. |
| **T4 — inference** | Derived by reasoning across tiers | Weakest. Marked `INFERRED` wherever used. |

**Resolution rule when two tiers disagree: T1 > T2 > T3 > T4.** A typed declaration beats readable
source; readable source beats a log; a log beats inference. Where a lower tier contradicts a higher one,
the higher tier wins and the contradiction is recorded in [§5.2](#52-reconciliation-notes) rather than
silently dropped. Two such corrections were made during ingestion and both changed a severity grade.

**Composition.** This file is assembled from the three fragments above. The fragment range that feeds
each section is recorded in [§9](#9-appendix-source-paths-read) so any claim can be traced back to the
evidence that produced it. Fragment-internal headings are preserved (demoted one or two levels so they
nest under this document's headings) — the fragment structure is itself evidence.

**What this document is not.** It is not an architecture. §7 states *constraints* only; the design that
satisfies them is Stage 2's job, and this brief deliberately does not pre-empt it.

## 2. Environment snapshot

| Item | Measured value |
|---|---|
| DSH runtime | `@deepseek-ai/dsh` **0.2.2-rc.3** |
| DSH install root | `/home/minami/.local/nodejs/lib/node_modules/@deepseek-ai/dsh` |
| DSH runtime packages | `/home/minami/.local/nodejs/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/` (the `DSH=` shorthand used throughout the fragments) |
| Plugin under audit | `@nolit/dsh-tokeneconomizer` **0.0.1-rc.5** |
| Plugin root | `/home/minami/Workspace/projects/dsh-workspace/dsh-plugins/dsh-tokeneconomizer` |
| Live profile | `~/.dsh/profiles/web` |
| Live session logs | `~/.dsh/sessions/<slug>/<session-id>/session.v4.jsonl.zstd` — **354** such files present at measurement time; the fragment-B worker sampled **350** of them for ground truth |
| Session format version | `SESSION_FORMAT_VERSION = 4` (`dsh-session/lib/types/types.d.ts:55`) |
| Plugin hard service deps | `export const inject = ['tools', 'systemPrompt', 'tokenMeter']` (`lib/index.js:83`) |
| Plugin engine assertion | `engines.dsh` — `">=0.2.2-alpha.2 <0.3.0"` (`package.json:61`) |
| Plugin manifest | `dsh.manifestVersion: 1`, `dsh.bundle.patch: './cordis.patch.yml'` (`package.json:46`, `:50-57`) |
| Plugin language | plain JavaScript ESM (`"type": "module"`, no `types` field) — **no typecheck channel** (`G-C-02`) |

The plugin is therefore *simultaneously* a JS consumer of typed contracts and a runtime-only observer of
them: it can be broken by a rename it cannot see coming. That asymmetry is the root cause of most of
§5.

### 2.1 What was **not** read

Stating the negative evidence is part of the method. The following were deliberately **not** read, and
no claim in this brief depends on them:

- **`<plugin>/lib/index.js` was never read whole** (1396 lines / 58 KB). It was read as narrow windows
  (415-514, 527-562, 615-729, 744-752, 765-884, 895-960, 960-1029, 1275-1354) plus targeted `grep -n`
  passes. The plugin's *intent* is therefore inferred from its call sites, not from its comments alone.
- **The DSH engine source is not present on this host.** The TokenEconomizer Python engine's own
  canonicalisation is unverifiable from here — see the `UNVERIFIABLE` line in §8.
- **`<dsh>/src/` and `<dsh>/lib/types/` were grepped, not read** — they appear in this brief only as
  grep results.
- **`dsh-agent-team` and `dsh-tool-subagent` payload schemas were not located.** Their event
  vocabularies are named in §8 but their contracts are not in this brief.
- **The session-log corpus was sampled, not exhaustively parsed.** Fragment B decompressed and read the
  header line and the event-type distribution across 350 logs; it did not parse every event payload of
  every log.
- **The four most recent logs were not in the sampled 350** (354 present, 350 sampled).



## 3. DSH core schema reference

### 3.1 Project / workspace identity and isolation

#### A.1 DSH project identity: findings

**Measured facts.**

1. **There IS a first-class Workspace entity** in DSH — `@deepseek-ai/dsh-workspace` — but it is
   *not* what the plugin would use as a per-project key. It is a **registry of user-registered
   directories** keyed by `fs.realpath` canonical path, with a UUID `WorkspaceId`, a display title,
   an ordered `sessionIds` account, and `createdAt`/`updatedAt`.
   - `node_modules/@deepseek-ai/dsh-workspace/lib/index.js:209-215` — durable record shape:
     `path`, `title`, `sessionIds`, `createdAt`, `updatedAt`.
   - `node_modules/@deepseek-ai/dsh-workspace/lib/index.js:652` — `const id = WorkspaceId(randomUUID());`
   - `node_modules/@deepseek-ai/dsh-workspace/lib/index.js:643-645` — `resolveByPath(path)`:
     `const canonical = await realpathNormalize(path); for (const entity of this.entities.values()) if (entity.path === canonical) return entity;`
     → **exact string equality on the realpath canon**. Not prefix, not slug.

2. **The Workspace entity is NOT the session-store grouping.** The session store groups sessions by
   a *derived directory name* computed from the raw `cwd` string (A.2). These are two independent
   notions of "project":
   - Workspace registry: registered directories, realpath-canonical, UUID-keyed, user-curated.
   - Session store project dir: derived, lossy, path-derived, auto-created for every session.

3. **The Workspace registry is a storage-domain unit, not a plugin-facing registry.** Durable file:
   `/home/minami/.dsh/storages/workspace.json` — unit `{"name":"workspace","version":2}` (measured).
   Spec: `dsh-workspace/lib/index.js:255-257` — `defineDomain({ name: "workspace", version: 2, … })`.

4. **The session header `cwd` is the raw, absolute, non-canonicalized string.**
   - `dsh-session/lib/types/index.js:48-49` — validation is only `isAbsolute(record.cwd)`; there is
     **no** realpath at header-write time.
   - `dsh-session/lib/types/index.js:1017` — `...meta?.cwd === undefined ? {} : { cwd: meta.cwd }`.
   - `dsh-api-session-controller/lib/index.js:414-427` — `createMinted(cwd, composition)` → `createAgent(...)` → `mkdir(cwd, {recursive:true})` then `cwd` straight into the session meta. The cwd is **not** realpath'd here.
   - Measured from a live log (`~/.dsh/sessions/--home-minami-Workspace-projects-dsh-workspace-dsh-plugins--/01c9ff36-…/session.v4.jsonl.zstd`, first line decompressed):
     `{"type":"session","version":4,"id":"01c9ff36-8cb3-4449-af24-98bbd5105311","createdAt":1794077970115,"cwd":"/home/minami/Workspace/projects/dsh-workspace/dsh-plugins",…}`
     and the containing directory name is `--home-minami-Workspace-projects-dsh-workspace-dsh-plugins--`
     → **the directory name is exactly `projectKey(cwd)` of that raw cwd**.

5. **The Workspace registry *does* realpath-canonicalize** — but only when it *reads* the header,
   not when it writes it: `dsh-workspace/lib/index.js:888-899` (`indexHeader`) does
   `const path = await realpathNormalize(header.cwd)` and, on failure, records
   `missingSessionPaths` / `invalidSessionPaths`. So a session whose `cwd` is a symlink or a moved
   directory still *exists* under its original slug but is *invalid* for workspace attachment.

#### A.2 Session store slug algorithm (verbatim code + path)

**Path:** `node_modules/@deepseek-ai/dsh-session-persistence-jsonl/lib/index.js`

`projectKey` — `dsh-session-persistence-jsonl/lib/index.js:871-899` (verbatim):

```js
/**
 * Build the readable directory key for a project path.
 * Filesystem separators and drive separators become `-`; unsafe code units use
 * the same `~XXXX` escape as session ids. The key is bounded for filesystem
 * component limits. Separator replacement and truncation are intentionally
 * lossy, following the common human-navigable project-directory convention.
 * @param cwd - the session's project directory.
 * @returns a single filesystem-safe project directory name.
 */
function projectKey(cwd) {
	if (cwd.length === 0) throw new Error("cannot encode an empty project path");
	let readable = "";
	let separatorRun = false;
	for (let i = 0; i < cwd.length; i++) {
		const code = cwd.charCodeAt(i);
		const ch = String.fromCharCode(code);
		if (ch === "/" || ch === "\\" || ch === ":") {
			if (!separatorRun) readable += "-";
			separatorRun = true;
		} else if (ch !== "~" && /^[A-Za-z0-9._-]$/.test(ch)) {
			readable += ch;
			separatorRun = false;
		} else {
			readable += "~" + code.toString(16).toUpperCase().padStart(4, "0");
			separatorRun = false;
		}
	}
	return `--${(readable.replace(/^-+/, "") || "root").slice(0, 251)}--`;
}
```

`projectDir` / `sessionDir` — `dsh-session-persistence-jsonl/lib/index.js:900-921` (verbatim):

```js
function projectDir(root, cwd) {
	if (cwd === void 0) return join(root, "_no-cwd");
	return join(root, projectKey(cwd));
}
…
function sessionDir(root, cwd, id) {
	return join(projectDir(root, cwd), encodeSegment(id));
}
```

**Exact algorithm (measured from source):**

| Step | Rule |
|---|---|
| 1 | Iterate UTF-16 **code units** of the raw `cwd` string. |
| 2 | `/`, `\`, `:` → a single `-`, and **consecutive** separators collapse to one `-` (`separatorRun` latch). |
| 3 | `A-Z a-z 0-9 . _ -` (and NOT `~`) → kept verbatim, case preserved. |
| 4 | Everything else (spaces, `~`, non-ASCII, control chars) → `~` + 4-hex-uppercase of the code unit (`~0020` for space, `~00E9` for `é`). |
| 5 | Leading `-` run stripped from the readable body; empty body → `root`. |
| 6 | Body truncated to **251** chars; result wrapped in `--` … `--`. |

**Lossiness — measured, definitively:**

- **Lossy by design.** The doc comment says so: *"Separator replacement and truncation are intentionally lossy"*. Two consequences:
  - `a/b` and `a-b` both → `a-b` → `--a-b--`. **Collision.**
  - `/a/b/c` and `/a-b/c` → both `--a-b-c--`. **Collision.**
- **Not reversible** in general: separators are flattened, so the original tree structure is
  unrecoverable; and truncation at 251 chars discards the tail — including the *most* distinguishing
  part of a deep path.
- **Case-sensitive**: the safe set explicitly includes `A-Z`, so `~/Foo` → `--home-Foo--` and
  `~/foo` → `--home-foo--` are different directories. On a case-insensitive filesystem (macOS
  default, Windows) these two **collide at the filesystem level** even though the strings differ.
  `INFERRED:` the key is computed as a string and used verbatim as a directory name, so on a
  case-insensitive FS `--home-Foo--` and `--home-foo--` are the same directory → two different
  projects share one store directory. **Measured for the Linux host only** (all live dirs are
  lowercase-distinct); the macOS/Windows behaviour is `INFERRED` from POSIX/Windows path semantics,
  not measured here.
- **Truncation collision risk**: two long paths sharing the first 251 readable chars map to the
  same directory. `INFERRED:` from the code, not measured with a live example.
- The `~XXXX` escape keeps a **UTF-16 code-unit** bijection for the escaped characters, so a
  literal `~` is safe; but the *whole* key is not injective because of step 2 and step 6.
- `encodeSegment` (`dsh-session-persistence-jsonl/lib/index.js:858-870`) — used for the **session
  id** segment — *is* injective over all JS strings (per its own doc comment), including `.`→`~002E`
  and `..`→`~002E~002E`. The session-id level is therefore lossless; the **project level is not**.

**Where the root comes from:** `dsh-session-persistence-jsonl/lib/index.js:3621-3625` —
`Config = z.object({ root: z.string().required(), … })`. The root is a configured string; the live
installation resolves it to `/home/minami/.dsh/sessions` (measured by listing the directory).

##### A.2b Is the slug stable? (Q2)

| Change | DSH slug | Engine repo key |
|---|---|---|
| **cwd renamed / moved** | ❌ **changes** — the slug is a pure function of the path string, so `/x/proj` → `/y/proj` yields `--x-proj--` → `--y-proj--`. The old dir keeps every session; the new dir starts empty. | ✅ **survives** under BY_REMOTE (the remote URL did not change) and under BY_PATH **only if the move is a move of the same checkout** — a plain `mv` changes the realpath, so BY_PATH/BY_DIR **also break**. Only BY_REMOTE is move-invariant. |
| **symlinked cwd** | ❌ **no realpath** — `projectKey` hashes the *symlink path* text. Two spellings of the same directory (`/x/proj` and `/ln/proj`) produce **two** DSH project dirs. DSH's own Workspace registry disagrees: it realpaths (`dsh-workspace/lib/types/paths.js:43-48`) and its comment says *"a symlink to an existing workspace's directory collides"*. | ⚠️ **partially** — `findRepoRoot` uses `resolve(start)`, i.e. the **lexical** path, so the `.git` lookup follows the symlink's *textual* ancestor chain, not the target's; but the BY_PATH/BY_DIR digest uses `realpathSync` (`repokey.js:55-61`, `:223`). |
| **does it use `realpath`?** | **No.** `projectKey(cwd)` takes the raw header string (`dsh-session-persistence-jsonl/lib/index.js:880`); the header itself is only validated as absolute (`dsh-session/lib/types/index.js:48-49`). | **Yes, for the hashed canon** — `realOrLexical` → `realpathSync` with a `resolve()` fallback (`repokey.js:55-61`). The **repo-root walk** is lexical (`resolve(start)`, `repokey.js:95`). |
| **case sensitivity** | **Case-sensitive** — `A-Z` is in the safe set (`dsh-session-persistence-jsonl/lib/index.js:890`). `--home-Foo--` ≠ `--home-foo--`. On a case-insensitive filesystem they are the *same* directory → aliasing. **Measured on Linux** (case-sensitive); the macOS/Windows aliasing is `INFERRED`. | **Case-insensitive for remotes** (`normalizeRemote` lowercases, `repokey.js:192`); **case-sensitive for paths** (`realpathSync` result is not lowercased). |
| **trailing slash / `..` segments** | ❌ not normalized — `/x/proj/` and `/x/proj` yield the *same* readable body (`/` → `-`, leading `-` stripped) so they coincidentally agree; but `/x/./proj` → `--x-.proj--` ≠ `--x-proj--`. | ✅ `resolve()` normalizes `.`/`..` before the walk (`repokey.js:95`, `:206`). |

**Verdict:** the DSH slug is **stable only as a function of the exact path string**. It is neither
canonical (symlinks, `..`) nor move-invariant nor injective. The engine key is canonical (realpath)
and repo-granular, and is move-invariant **only** for remotes.

#### A.3 Project/workspace metadata store

| Store | Where | Key | Has display name? | Has timestamps? |
|---|---|---|---|---|
| **Workspace registry** (DSH core) | `/home/minami/.dsh/storages/workspace.json`, unit `workspace` v2 | `WorkspaceId` = `randomUUID()` | `title` (default = basename of path) | `createdAt`, `updatedAt` (ISO-8601) |
| **Workspace→session account** | same file, `tables.workspaces[<id>].sessionIds` | array order = display order | — | — |
| **Registry-global pin / archive sets** | same file, `global.pinnedSessionIds`, `global.archivedSessionIds` | session id | — | — |
| **Session store project dir** | `~/.dsh/sessions/--<slug>--/` | derived lossy slug | ❌ none | ❌ none |
| **Session header** | `session.v4.jsonl.zstd` line 1 | session id | ❌ | `createdAt` (epoch ms) |

Evidence:
- `dsh-workspace/lib/index.js:209-215` — `workspaceRecord` zod schema (`path`, `title`,
  `sessionIds`, `createdAt`, `updatedAt`).
- `dsh-workspace/lib/index.js:240-248` — `workspaceDomainState` (`initialized`, `defaultWorkspaceId`,
  `workspaceIds`, `archivedSessionIds`, `pinnedSessionIds`, `pendingMutation`).
- `dsh-workspace/lib/types/paths.js:26-29` — `defaultWorkspaceTitle(path)` =
  `pathApi.basename(path) || pathApi.parse(path).root`.
- Measured `/home/minami/.dsh/storages/workspace.json`: 13 workspace ids; e.g.
  `"970131f8-5a2d-4d2f-b1aa-0a2d7869fedb":{"path":"/home/minami/Workspace/projects/release-harness","title":"Core-99-UROH",…}`.
  → **The display title is user-set and does NOT match the path basename** ("Core-99-UROH" vs
  `release-harness`). Any plugin keying on `basename(path)` would disagree with the user's title.
- Measured: `global.pinnedSessionIds` is `[]` and `global.archivedSessionIds` is `[]` in the live
  file — so pinning is a **session-level** concept in DSH, **not** a project-level one.

**`dsh-sidebar-manager` (known plugin track):** it does **not** implement its own project identity.
- `dsh-sidebar-manager/lib/index.js:17-23` — `inject = ['connection','workspaceRegistry','sessionPersistence','agents','sessions']`
  → it consumes DSH's own `ctx.workspaceRegistry` (the UUID registry above).
- `dsh-sidebar-manager/lib/groups.mjs:75-80` — its own *group membership* fingerprint:
  ```js
  function normalizePath(value) {
    return typeof value === 'string' ? path.resolve(value).replace(/\\/g, '/').toLowerCase() : ''
  }
  function fingerprintOf({ path: workspacePath, title } = {}) {
    return { path: normalizePath(workspacePath), title: typeof title === 'string' ? title : '' }
  }
  ```
  → **a fourth canonicalization rule**: `path.resolve` + backslash→slash + **lowercase**. Not
  realpath (no symlink resolution), and case-folded — so it collides with DSH's case-sensitive
  `projectKey` and with the workspace registry's case-sensitive realpath canon.
- `dsh-sidebar-manager/lib/groups.mjs:82-85` — `sameFingerprint` compares `path` **and** `title`,
  so a title rename orphans the membership.

**There is no per-project "display name" store for unregistered directories.** A directory that was
never registered as a Workspace exists in the session store only as `--<slug>--`, with no title,
no createdAt, no pin state.

**Workspace identity is immutable — both `path` and `cwd` are frozen facts.**
- `dsh-workspace/lib/types/entity.js:57-83` (verbatim): *"Validation is skipped when the settled
  snapshot already accounts the id: the cwd fact was checked when it first attached and **both
  inputs (stored header cwd, workspace path) are immutable**."* The attach check is
  `if (cwd !== this.record.path) throw new Error(...)` (`:80-82`).
- The only mutator on the entity is `setTitle` (`dsh-workspace/lib/types/entity.js:54-56`).
  There is **no** `setPath` / `rename` / `move` on the Workspace entity — grep for
  `async move|async rename|retitle|updatePath` in `dsh-workspace/lib/index.js` returns only
  `setTitle` (`:105`) and a comment (`:421`).
- **Consequence:** if a workspace directory is renamed on disk, its Workspace record keeps the
  **old** realpath, the sessions under it become `missingSessionPaths`, and the record is stuck.
  There is no supported "workspace moved" operation.

### 3.2 Session header schema

#### B.1 HeaderLine (full, verbatim)

##### B.1.1 Two distinct declarations — do not conflate

There are **two** header shapes in DSH 0.2.2-rc.3, and the task brief's pointer (`dsh-session/lib/types/types.d.ts` line ~70-100) is the *in-memory* one, not the on-disk one:

| Shape | Declared at | Role |
|---|---|---|
| `SessionHeader` | `DSH/dsh-session/lib/types/types.d.ts:59` | immutable in-memory storage metadata |
| `HeaderLine` | `DSH/dsh-session-persistence-jsonl/lib/types/format.d.ts:42` | the physical first JSONL record on disk |

##### B.1.2 `HeaderLine` — on-disk, verbatim

`DSH/dsh-session-persistence-jsonl/lib/types/format.d.ts:38-53`:

```ts
    /**
     * The current physical header stored as the first JSONL record. The exact
     * inherited cut lives on the last tagged `session/end-seed` event.
     */
    interface HeaderLine {
        type: 'session';
        version: number;
        id: SessionId;
        createdAt: number;
        cwd?: string;
        parentSession?: SessionId;
        isSeeded: boolean;
        origin?: 'subagent';
        delegationDepth: number;
        agentPreset?: string;
    }
```

Note the differences from `SessionHeader`: `HeaderLine` has the literal discriminator `type: 'session'`, `version: number` (not the literal `4`), and `delegationDepth: number` is **required** (not optional). `HeaderLine` is declared **without `export`** (module-private), so it cannot be imported by a plugin.

##### B.1.3 `SessionHeader` — in-memory, verbatim

`DSH/dsh-session/lib/types/types.d.ts:56-100`:

```ts
    /**
     * Immutable validated storage metadata, kept outside the conversation event log.
     */
    export interface SessionHeader {
        /**
         * Current logical format version, stamped from {@link SESSION_FORMAT_VERSION}.
         * Historical physical headers are translated before entering this interface.
         */
        readonly version: typeof SESSION_FORMAT_VERSION;
        /** The session's id (mirrors the {@link Session}'s id). */
        readonly id: SessionId;
        /** Non-negative safe-integer Unix epoch milliseconds when the session was created. */
        readonly createdAt: number;
        /** Absolute working directory the session was created in (if any). */
        readonly cwd?: string;
        /**
         * Direct creator of a subagent Session. Ordinary forks omit this field;
         * historical ordinary forks may retain their source id here. Presence alone
         * does not classify a Session as a subagent; use `origin` for that distinction.
         */
        readonly parentSession?: SessionId;
        /**
         * Whether this Session contains a fork-inherited event prefix. The exact prefix
         * length is Session state rather than ordinary header metadata.
         */
        readonly isSeeded: boolean;
        /**
         * Coarse product classification for a session created as a subagent child.
         * This is presentation metadata, not proof that the child is continuable.
         */
        readonly origin?: 'subagent';
        /**
         * Delegation depth: absent (zero) for a top-level session, parent depth + 1
         * for a subagent child. Persisted so a recursion budget survives restart and
         * resume — a runtime-only depth would reset a resumed child to top-level.
         */
        readonly delegationDepth?: number;
        /**
         * Id of the agent preset this session's agent was composed from, when the
         * deployment composes per session. Durable because the preset decides the
         * session's tools and prompt: a resume that restored a different composition
         * would replay history the model can no longer act on.
         */
        readonly agentPreset?: string;
    }
```

**Complete field list (both shapes):** `type` (disk only), `version`, `id`, `createdAt`, `cwd?`, `parentSession?`, `isSeeded`, `origin?`, `delegationDepth`, `agentPreset?`. There are **no** other header fields. `SESSION_FORMAT_VERSION = 4` (`DSH/dsh-session/lib/types/types.d.ts:55`).

A retired-field guard exists: `assertNoRetiredHeaderFields(value)` at `DSH/dsh-session-persistence-jsonl/lib/types/format.d.ts:59` — "Refuse policy fields that never belong to a released Session header." (i.e. adding a new header field on disk is a contract change that the released reader may reject).

Serialization entry point: `toHeaderLine(header: SessionHeader, inheritedEventCount?: SessionLogOffsetType): HeaderLine` — `DSH/dsh-session-persistence-jsonl/lib/types/format.d.ts:60-67`:

```ts
    /**
     * Build the header line object from a {@link SessionHeader}.
     * @param header - the immutable session metadata to serialize.
     * @param inheritedEventCount - exact inherited prefix length; required for a
     * seeded header and omitted only for an unseeded header.
     * @returns the `type: 'session'`-tagged line object, absent optional fields omitted (never null).
     */
    export declare function toHeaderLine(header: SessionHeader, inheritedEventCount?: SessionLogOffsetType): HeaderLine;
```

---

#### B.2 Discriminator semantics (verbatim doc comments)

| Discriminator | Verbatim meaning | Source |
|---|---|---|
| `origin` | "Coarse product classification for a session created as a subagent child. This is presentation metadata, not proof that the child is continuable." | `dsh-session/lib/types/types.d.ts:82-86` |
| `parentSession` | "Direct creator of a subagent Session. Ordinary forks omit this field; historical ordinary forks may retain their source id here. Presence alone does not classify a Session as a subagent; use `origin` for that distinction." | `dsh-session/lib/types/types.d.ts:71-76` |
| `delegationDepth` | "Delegation depth: absent (zero) for a top-level session, parent depth + 1 for a subagent child. Persisted so a recursion budget survives restart and resume — a runtime-only depth would reset a resumed child to top-level." | `dsh-session/lib/types/types.d.ts:87-92` |
| `agentPreset` | "Id of the agent preset this session's agent was composed from, when the deployment composes per session. Durable because the preset decides the session's tools and prompt: a resume that restored a different composition would replay history the model can no longer act on." | `dsh-session/lib/types/types.d.ts:93-99` |
| `isSeeded` | "Whether this Session contains a fork-inherited event prefix. The exact prefix length is Session state rather than ordinary header metadata." | `dsh-session/lib/types/types.d.ts:77-81` |
| `version` | "Current logical format version, stamped from `SESSION_FORMAT_VERSION`. Historical physical headers are translated before entering this interface." + the long version-policy comment at `types.d.ts:33-54` | `dsh-session/lib/types/types.d.ts:60-64` |
| `cwd` | "Absolute working directory the session was created in (if any)." | `dsh-session/lib/types/types.d.ts:69-70` |
| `id` | "The session's id (mirrors the `Session`'s id)." | `dsh-session/lib/types/types.d.ts:65-66` |
| `createdAt` | "Non-negative safe-integer Unix epoch milliseconds when the session was created." | `dsh-session/lib/types/types.d.ts:67-68` |

##### B.2.1 Explicitly absent header discriminators

- **No `kind` / `mode` / `role` field on the session header.** The only discriminator-shaped header field is `origin?: 'subagent'` — a single-valued union, i.e. **binary** (top-level vs subagent child). There is no `role`, no `parentRole`, no `executionMode`.
- **No `parallel` / `background` flag.** INFERRED: parallelism is a runtime property of the agent-team/subagent spawn path, not a persisted session-header field.
- `parentSession` presence does **not** imply subagent ("Presence alone does not classify a Session as a subagent; use `origin` for that distinction." — `types.d.ts:74-75`).

##### B.2.2 `CreateSessionOptions.meta` — the write-side mirror

`DSH/dsh-session/lib/types/types.d.ts:101-128`:

```ts
    /**
     * Options for creating a {@link Session} via the store. `seed` replays/forks
     * an existing event log; `meta` carries the caller-supplied storage fields the
     * store folds into a {@link SessionHeader}.
     */
    export interface CreateSessionOptions {
        /** Initial replay or fork history supplied at construction. */
        readonly seed?: readonly SessionEvent[];
        /**
         * Exact fork-inherited prefix length when `meta.isSeeded` is true. The
         * constructor appends the child-owned tagged marker at the cut unless
         * the seed already includes it followed by child-owned fork closers.
         */
        readonly inheritedEventCount?: SessionLogOffset;
        /**
         * Storage metadata read once before publication. `isSeeded` marks fork
         * lineage; supplying replay history alone does not make it inherited.
         */
        readonly meta?: {
            readonly cwd?: string;
            readonly parentSession?: SessionId;
            readonly createdAt?: number;
            readonly isSeeded?: boolean;
            readonly origin?: 'subagent';
            readonly delegationDepth?: number;
            readonly agentPreset?: string;
        };
    }
```

Note: `meta` has **no `version` and no `id`** — those are minted by the store.

---

### 3.3 Session event catalog

#### B.4 Session event catalog

##### B.4.1 Two catalogs exist — the released set and the plugin-merged set

**Released/known event types** — the set this build understands, generated file
`DSH/dsh-session/lib/types/known-event-types.js:21-85` (`KNOWN_SESSION_EVENT_TYPES`, 63 entries).
Its own header comment (`known-event-types.js:7-20`):

> Every `SessionEventMap` member declared in this repository — the event vocabulary this build understands. The persistence read path **refuses to interpret a log containing a type outside this set** unless the event carries the envelope's `ignorable` marker … such a log was likely written by a newer harness, and silently skipping a required event would reconstruct a wrong session. Downstream (out-of-repo) plugin events are outside this list by construction. The persisted `SessionEvent.ignorable` marker is the compatibility mechanism; event-name registration was rejected because it does not classify omission safety and would make reads composition-dependent.

**Core `SessionEventMap`** — `DSH/dsh-session/lib/types/types.d.ts:261-441` (13 members) plus **plugin-merged extensions** via `declare module '@deepseek-ai/dsh-session/types'` in ~20 packages. The extension points are `dsh-agent`, `dsh-agent-team`, `dsh-agent-preset-registry`, `dsh-compaction`, `dsh-compaction-image-offload`, `dsh-goal`, `dsh-jobs`, `dsh-llm-retry`, `dsh-commands`, `dsh-command-feedback`, `dsh-subagent`, and others.

##### B.4.2 Core `SessionEventMap` (released, in `dsh-session/lib/types/types.d.ts`)

| # | `type` | Payload shape | Surface? | Plugin observes? |
|---|---|---|---|---|
| 1 | `turn/start` | `{ turn: number }` | no (log-only) | **yes** — `lib/index.js:774,937` |
| 2 | `turn/end` | `{ turn: number; reason: TurnEndReason }` | no | **yes** — `lib/index.js:791,941` |
| 3 | `step/start` | `{ turn: number; step: number }` | no | no |
| 4 | `step/end` | `{ turn: number; step: number }` | no | no |
| 5 | `user/message` | `UserMessage` (has `source.kind`) | **yes** | **yes** — `lib/index.js:784,945` |
| 6 | `developer/message` | `{ turn; step; message: DeveloperMessage; headerSeq?: SessionSeq }` | **yes** | no |
| 7 | `system/message` | `{ turn; step; message: SystemMessage }` | **yes** | **yes** — `lib/index.js:924` |
| 8 | `assistant/message` | `{ turn; step; message: AssistantMessage; stream: AssistantStreamRecord[]; usage?: TokenUsage; interrupted?: true }` | **yes** | **yes** — `lib/index.js:932` |
| 9 | `assistant/attempt` | `{ turn; step; stream: AssistantStreamRecord[] }` | no | no |
| 10 | `tool/call` | `{ turn; step; callId: ToolCallId; name: string; arguments: string }` | no | **yes** — `lib/index.js:901` |
| 11 | `tool/result` | `{ turn; step; message: ToolResultMessage; error?: {name,code,reason?}; meta?: JsonValue }` | **yes** | **yes** — `lib/index.js:841,920` |
| 12 | `request/header` | `{ header: EpochHeader; reason: RequestHeaderReason; startsSeries?: true }` | no | no |
| 13 | `request/context` | `RequestContext` | no | no |
| 14 | `session/end-seed` | `{ inherited?: true }` | no | no (and MUST NOT append) |

##### B.4.3 Full released event-type set (`KNOWN_SESSION_EVENT_TYPES`, 63)

`agent-preset/selected`, `agent/inbox/spliced`, `approval/asked`, `approval/decided`, `approval/policy`, `assistant/attempt`, `assistant/message`, `command/done`, `command/run`, `compaction/end`, `compaction/prune`, `compaction/start`, `compaction/summary`, `deliverables/presented`, `developer/message`, `feedback/message-delete`, `feedback/message-put`, `feedback/record`, `goal/change`, `hook/invoked`, `hook/result`, `image/offload`, `job/registered`, `job/settled`, `llm/retry`, `llm/retry-started`, `model/selection`, `permission/preset`, `plan/mode`, `request/context`, `request/header`, `sandbox/mode`, `schedule/change`, `session-log-deepseek/delivery-accepted`, `session/end-seed`, `session/title`, `session/title-llm-request`, `step/end`, `step/start`, `subagent/catalog`, `subagent/descriptor`, `subagent/model-selection-policy`, `system/message`, `team/member`, `team/message/delivered`, `team/message/queued`, `team/mode`, `team/task`, `todo/write`, `tool-workflow/agent-end`, `tool-workflow/agent-start`, `tool-workflow/run-end`, `tool-workflow/run-start`, `tool/call`, `tool/ptc-dispatch`, `tool/ptc-dispatch-start`, `tool/result`, `turn/end`, `turn/start`, `user/message`, `web/deepseek-search-llm-request`, `working-directory/change`, `workspace/changes`.

Plus `MESSAGE_PROJECTION_EVENT_TYPES = new Set(['image/offload'])` — `known-event-types.js:87-89`.

##### B.4.4 Real-log ground truth (350 logs scanned)

Types actually observed, by count (top): `tool/result` 49683, `tool/call` 47635, `step/start` 39699, `step/end` 39692, `assistant/message` 39614, `job/registered` 31032, `job/settled` 31019, `session-log-deepseek/delivery-accepted` 13253, `tool/ptc-dispatch-start` 10563, `tool/ptc-dispatch` 10562, `agent/inbox/spliced` 5832, `user/message` 5224, `compaction/prune` **2052**, `turn/start` 1900, `turn/end` 1893, `request/header` 770, `workspace/changes` 738, `session/title` 525, `permission/preset` 473, `sandbox/mode` 464, `approval/policy` 464, `system/message` 404, `request/context` 381, `subagent/catalog` 349, `subagent/model-selection-policy` 329, `team/task` 306, `session/end-seed` 293, `model/selection` 256, `command/run` 241, `command/done` 241, `todo/write` 237, `session/title-llm-request` 231, `subagent/descriptor` 217, `approval/asked` 182, `approval/decided` 182, `assistant/attempt` 178, `team/member` 150, `agent-preset/selected` 122, `llm/retry` 98, `llm/retry-started` 98, `web/deepseek-search-llm-request` 95, `deliverables/presented` 51, `compaction/start` 34, `compaction/end` 34, `developer/message` 28, `compaction/summary` 22, `tool-workflow/agent-start` 15, `tool-workflow/agent-end` 15, `plan/mode` 12, `team/mode` 8, `working-directory/change` 7, `tool-workflow/run-start` 4, `tool-workflow/run-end` 4, `goal/change` 4.

**Observed but NOT in `KNOWN_SESSION_EVENT_TYPES`:** `session-log-deepseek/delivery-accepted` **is** in the set (line 55) — verified. But `session/title-llm-request` is in the set (line 58). Every observed type was checked against the 63-entry list; **all 50 distinct observed types are members of the released set.** No unknown-type events were found in the live corpus.

**Plugin-observed subset** (from `lib/index.js` grep, `observeMemory` + `onEvent`): `turn/start`, `turn/end`, `user/message`, `system/message`, `assistant/message`, `tool/call`, `tool/result` — **7 of 14 core types**. The plugin observes **no** `step/*`, `developer/message`, `assistant/attempt`, `request/*`, or `session/end-seed` events.

---

### 3.4 Subagent / delegation schema

#### B.2 Discriminator semantics (verbatim doc comments)

| Discriminator | Verbatim meaning | Source |
|---|---|---|
| `origin` | "Coarse product classification for a session created as a subagent child. This is presentation metadata, not proof that the child is continuable." | `dsh-session/lib/types/types.d.ts:82-86` |
| `parentSession` | "Direct creator of a subagent Session. Ordinary forks omit this field; historical ordinary forks may retain their source id here. Presence alone does not classify a Session as a subagent; use `origin` for that distinction." | `dsh-session/lib/types/types.d.ts:71-76` |
| `delegationDepth` | "Delegation depth: absent (zero) for a top-level session, parent depth + 1 for a subagent child. Persisted so a recursion budget survives restart and resume — a runtime-only depth would reset a resumed child to top-level." | `dsh-session/lib/types/types.d.ts:87-92` |
| `agentPreset` | "Id of the agent preset this session's agent was composed from, when the deployment composes per session. Durable because the preset decides the session's tools and prompt: a resume that restored a different composition would replay history the model can no longer act on." | `dsh-session/lib/types/types.d.ts:93-99` |
| `isSeeded` | "Whether this Session contains a fork-inherited event prefix. The exact prefix length is Session state rather than ordinary header metadata." | `dsh-session/lib/types/types.d.ts:77-81` |
| `version` | "Current logical format version, stamped from `SESSION_FORMAT_VERSION`. Historical physical headers are translated before entering this interface." + the long version-policy comment at `types.d.ts:33-54` | `dsh-session/lib/types/types.d.ts:60-64` |
| `cwd` | "Absolute working directory the session was created in (if any)." | `dsh-session/lib/types/types.d.ts:69-70` |
| `id` | "The session's id (mirrors the `Session`'s id)." | `dsh-session/lib/types/types.d.ts:65-66` |
| `createdAt` | "Non-negative safe-integer Unix epoch milliseconds when the session was created." | `dsh-session/lib/types/types.d.ts:67-68` |

##### B.2.1 Explicitly absent header discriminators

- **No `kind` / `mode` / `role` field on the session header.** The only discriminator-shaped header field is `origin?: 'subagent'` — a single-valued union, i.e. **binary** (top-level vs subagent child). There is no `role`, no `parentRole`, no `executionMode`.
- **No `parallel` / `background` flag.** INFERRED: parallelism is a runtime property of the agent-team/subagent spawn path, not a persisted session-header field.
- `parentSession` presence does **not** imply subagent ("Presence alone does not classify a Session as a subagent; use `origin` for that distinction." — `types.d.ts:74-75`).

##### B.2.2 `CreateSessionOptions.meta` — the write-side mirror

`DSH/dsh-session/lib/types/types.d.ts:101-128`:

```ts
    /**
     * Options for creating a {@link Session} via the store. `seed` replays/forks
     * an existing event log; `meta` carries the caller-supplied storage fields the
     * store folds into a {@link SessionHeader}.
     */
    export interface CreateSessionOptions {
        /** Initial replay or fork history supplied at construction. */
        readonly seed?: readonly SessionEvent[];
        /**
         * Exact fork-inherited prefix length when `meta.isSeeded` is true. The
         * constructor appends the child-owned tagged marker at the cut unless
         * the seed already includes it followed by child-owned fork closers.
         */
        readonly inheritedEventCount?: SessionLogOffset;
        /**
         * Storage metadata read once before publication. `isSeeded` marks fork
         * lineage; supplying replay history alone does not make it inherited.
         */
        readonly meta?: {
            readonly cwd?: string;
            readonly parentSession?: SessionId;
            readonly createdAt?: number;
            readonly isSeeded?: boolean;
            readonly origin?: 'subagent';
            readonly delegationDepth?: number;
            readonly agentPreset?: string;
        };
    }
```

Note: `meta` has **no `version` and no `id`** — those are minted by the store.

---

#### B.3 Agent role / preset / parallelism / lineage fields

##### B.3.1 There is NO agent-role field on the session or the Agent handle

- `Agent` (the public handle) declares exactly **one** field: `readonly id: SessionId` — `DSH/dsh-agent/lib/types/types.d.ts:11-15`:

```ts
/** Public live-agent handle; the runtime face augments its live capabilities. */
export interface Agent {
    /** Session-backed Agent identity. */
    readonly id: SessionId;
}
```

- The runtime augmentation (`DSH/dsh-agent/lib/types/runtime-types.d.ts:163-238`) adds `options`, `session`, `model`, `inbox`, `status`, `ctx`, plus methods `cancel`, `whenIdle`, `runMaintenance`, `send`, `followup`, `steer`, `inject`. **No `role`, no `preset`, no `kind`, no `mode`, no `isSubagent`.**

##### B.3.2 Where "role"-like information actually lives

| Concept | Location | Evidence |
|---|---|---|
| Subagent-ness (binary) | session header `origin?: 'subagent'` | `dsh-session/lib/types/types.d.ts:86` |
| Preset identity | session header `agentPreset?: string` | `dsh-session/lib/types/types.d.ts:99` |
| Delegation depth | session header `delegationDepth?: number` | `dsh-session/lib/types/types.d.ts:92` |
| Child lifecycle mode | `subagent/descriptor` event `mode: 'one-shot' \| 'continuable'` | `dsh-subagent/lib/types/descriptor.d.ts:50` |
| Child provider | `subagent/descriptor` event `provider: string` | `dsh-subagent/lib/types/descriptor.d.ts:52` |
| Child composition (model/provider/effort/persona/toolFilter) | `subagent/descriptor` (`mode:'continuable'` only) | `dsh-subagent/lib/types/descriptor.d.ts:65-79` |
| Parent-side child registry | `subagent/catalog` event, `mode: 'one-shot' \| 'continuable' \| 'unknown' \| 'external'`, `name` (v3) | `dsh-subagent/lib/types/catalog.d.ts:15-45` |

`subagent/descriptor` is the only durable place a child's **role/mode** is recorded, and it is **log-only** — "Log-only: it carries no `surfaceOp`, never enters model history, and survives compaction." (`dsh-subagent/lib/types/descriptor.d.ts:31-34`).

Verbatim (descriptor base, `dsh-subagent/lib/types/descriptor.d.ts:45-53`):

```ts
/** Fields shared by every supported `subagent/descriptor` payload. */
interface SubagentDescriptorBase {
    /** Descriptor format version ({@link SUBAGENT_DESCRIPTOR_VERSION}). */
    readonly version: number;
    /** Whether the child is a terminal one-shot run or a resumable conversation. */
    readonly mode: 'one-shot' | 'continuable';
    /** The `ctx.subagents` provider name that established the child. */
    readonly provider: string;
}
```

##### B.3.3 Parallel / background execution

**No parallel or background flag is persisted in the session header.** The only textual occurrence of "background" in the subagent types is a runtime method doc — "Start one continuable background child and resolve at initial inbox acceptance." (`DSH/dsh-subagent/lib/types/manager.d.ts:85`). INFERRED: parallelism is expressed by *how many* children exist and by the parent-owned `subagent/catalog`, not by a per-session header bit.

##### B.3.4 Fork lineage vs compaction lineage — three DISTINCT mechanisms

| Lineage | Marker | Where | Evidence |
|---|---|---|---|
| **Fork (session lineage)** | header `isSeeded: boolean` + `parentSession?` + `inheritedEventCount` | session header / Session object | `dsh-session/lib/types/types.d.ts:76-81`; `dsh-session/lib/types/index.d.ts:160` |
| **Fork cut inside the log** | `session/end-seed` event with `{ inherited?: true }` | event log | `dsh-session/lib/types/types.d.ts:414-440` |
| **Compaction lineage** | `compaction/start` → `compaction/summary` → `compaction/end` events, `compactionId` | event log | `dsh-compaction/lib/types/types.d.ts:18-100` |

`session/end-seed` — verbatim, `dsh-session/lib/types/types.d.ts:414-440`:

```ts
    /**
     * Separates inherited or restored history from later lifecycle-owned work.
     * This log-only marker need not be at {@link Session.firstLiveSeq}: a fork
     * seed can already contain its tagged marker and child-owned synthetic
     * closers before construction.
     *
     * A fresh fork child owns one `{ inherited: true }` marker at its exact
     * inherited-prefix cut, even when that prefix ends in an ancestor marker.
     * `buildForkSeed` appends that marker before any synthetic closers; the
     * `Session` constructor supplies it when given only the inherited prefix.
     * The last tagged marker is the current Session's cut; untagged markers
     * keep ordinary restore and replay lifecycle boundaries.
     *
     * Only the `Session` constructor and `buildForkSeed` may create this marker.
     * Session append does not reject other writers, so a plugin appending one
     * would silently classify every live bracket before it as seed history.
     *
     * An owner of a standalone open/close bracket (`compaction/start` …
     * `compaction/end`) reads it because seed history and live work are otherwise
     * byte-identical: an unmatched opening marker before this event belongs to
     * an ended lifecycle, whatever ended it. NOT a liveness signal about other
     * writers — a concurrently live session holds its own boundary elsewhere,
     * so tolerating concurrent writers needs a signal beyond the log.
     */
    'session/end-seed': {
        inherited?: true;
    };
```

> **This is a hard prohibition against the plugin:** "Only the `Session` constructor and `buildForkSeed` may create this marker." The plugin does not append it (verified by grep — see B.11), so it is compliant today; but any future plugin append of `session/end-seed` would silently corrupt lineage classification.

**Important distinction for `isSeeded`:** "Whether this Session contains a fork-inherited event prefix. The exact prefix length is Session state rather than ordinary header metadata." (`dsh-session/lib/types/types.d.ts:78-80`) — so the **length** is NOT in the header; it lives in `session.inheritedEventCount` and the last `session/end-seed` marker.

**Real-log check:** across 350 live logs, **0** logs had `isSeeded: true` AND `parentSession` set together — the header keys observed were exactly `type, version, id, createdAt, cwd, isSeeded, delegationDepth, agentPreset, parentSession, origin`. This corroborates "Ordinary forks omit this field; historical ordinary forks may retain their source id here" (`types.d.ts:72-73`): in practice `parentSession` and `isSeeded` are orthogonal in this build.

##### B.3.5 Compaction lineage is NOT a header field

Compaction is recorded purely as events. `dsh-compaction/lib/types/types.d.ts:80-95` (verbatim):

```ts
        /**
         * Shadow price of one model-free prune replacement — log-only, no
         * surfaceOp. The shared shadow-price protocol: a surface `replace` event
         * is priced by the metering event immediately before it (`compaction/summary`
         * for a summarizing compaction, this event for a prune), which states the
         * heuristic token price of the exact replaced range so a pure consumer
         * can subtract it without retaining per-node prices. The replacement MUST
         * be appended synchronously right after this event.
         */
        'compaction/prune': {
            /** The replaced range's first and last surface-node seqs (a surface-position span, like {@link CompactionResult.shadowedRange}). */
            shadowedRange: {
                start: SessionSeq;
                end: SessionSeq;
            };
            /** The seqs of all shadowed surface nodes, in surface order. */
            shadowedSeqs: SessionSeq[];
            /** Heuristic price of the shadowed content under the token-meter's fixed estimator. */
            shadowedTokenCount: number;
        };
```


---

### 3.5 surfaceOp append contract

#### B.5 `surfaceOp` append contract (verbatim type + semantics + consumer + sibling producer)

##### B.5.1 The type — verbatim

`DSH/dsh-session/lib/types/types.d.ts:453-483`:

```ts
/**
 * How a session event entered the ordered surface. Only valid on
 * {@link SurfaceEventType} events.
 *
 * - `'append'`: added to the tail — normal path for user/assistant/tool
 *   messages.
 * - `{ op: 'replace', startSeq, endSeq }`: replaces surface nodes from `startSeq`
 *   (inclusive) through `endSeq` (inclusive) with this node. Both must exist as
 *   surface nodes in the current surface. `startSeq === endSeq` replaces a single
 *   node. The node's {@link SessionEvent.sourceEventSeqs} must include every
 *   shadowed surface node. Used by compaction; any surface-replacing producer
 *   may use it.
 */
export type SurfaceOp = 'append' | {
    op: 'replace';
    startSeq: SessionSeq;
    endSeq: SessionSeq;
};
/**
 * Surface placement and cited source-event seqs for {@link Session.append}. Required on
 * message-producing events and forbidden on log-only events.
 */
export type SurfaceIntent<T extends SurfaceEventType = SurfaceEventType> = {
    surfaceOp: SurfaceOp;
} & (T extends 'assistant/message' ? {
    /** Assistant messages embed their provider stream instead of citing source events. */
    sourceEventSeqs?: never;
} : {
    /** Complete non-empty set of known earlier source-event seqs. */
    sourceEventSeqs?: SessionSeq[];
});
```

**Allowed `op` values — there are exactly TWO:**
1. `'append'` (string literal) — added to the surface tail.
2. `{ op: 'replace', startSeq, endSeq }` — replaces the inclusive surface range `[startSeq, endSeq]`.

There is **no** `'remove'`, `'delete'`, `'prepend'`, `'insert'`, or `'shadow'` op. Removal is only ever expressed as the *shadowing* half of a `replace`.

##### B.5.2 Surface-eligible types

`DSH/dsh-session/lib/types/types.d.ts:444-452`:

```ts
/**
 * The subset of {@link SessionEventType} values whose events produce LLM
 * messages and are eligible to appear on the ordered surface. Only these
 * event types may carry {@link SurfaceOp}; system, user, and tool events may also cite
 * earlier sources through {@link SessionEvent.sourceEventSeqs}.
 */
export type SurfaceEventType = 'system/message' | 'developer/message' | 'user/message' | 'assistant/message' | 'tool/result';
```

**Only these 5 types may carry `surfaceOp`.** Note `developer/message` is surface-eligible but `assistant/message` **must NOT** carry `sourceEventSeqs` ("Assistant messages embed their provider stream instead of citing source events." — `types.d.ts:478`).

##### B.5.3 `SessionEvent` envelope — `surfaceOp`/`sourceEventSeqs` are conditional

`DSH/dsh-session/lib/types/types.d.ts:501-524`:

```ts
export type SessionEvent<T extends SessionEventType = SessionEventType> = {
    [K in SessionEventType]: {
        type: K;
        /** Monotonic sequence number within the session. */
        seq: SessionSeq;
        /** Unix epoch milliseconds. */
        time: number;
        data: SessionEventMap[K];
        /**
         * Marks an event a reader may safely skip when it does not recognize
         * `type`. Absent means required: a reader meeting an unrecognized type
         * without this marker MUST refuse to reconstruct the session instead of
         * silently dropping the event, because an unrecognized required event may
         * change how the rest of the log is interpreted. A writer sets `true` only
         * on purely informational records whose loss cannot affect reconstruction;
         * defaulting to required means a forgotten marker over-refuses (an
         * inconvenience) rather than silently resuming a gutted session.
         */
        ignorable?: true;
    } & (K extends SurfaceEventType ? SurfaceIntent<K> : {
        surfaceOp?: never;
        sourceEventSeqs?: never;
    });
}[T];
```

##### B.5.4 Runtime validation rules (the actual contract, enforced not just typed)

`DSH/dsh-session/lib/types/surface.js:200-263` — `surfaceOpOf()` / `assertSourceEventReferences()`:

| Rule | Error text (verbatim) | Line |
|---|---|---|
| Non-surface event may not carry `surfaceOp` | `session event "${event.type}" is not surface-eligible and cannot carry surfaceOp` | `surface.js:208` |
| Non-surface event may not carry `sourceEventSeqs` | `session event "${event.type}" is not surface-eligible and cannot carry sourceEventSeqs` | `surface.js:211` |
| Surface-eligible event MUST carry a marker | `session event "${event.type}" is surface-eligible and requires a surfaceOp marker` | `surface.js:217` |
| Malformed op object | `session event "${event.type}" carries an invalid surfaceOp` | `surface.js:222` |
| `replace` op must have exactly `{op,startSeq,endSeq}` | `session event "${event.type}" carries an invalid replace surfaceOp` | `surface.js:225` |
| `replace` must reference **earlier** seqs | `surface replace at seq ${event.seq}: startSeq and endSeq must reference earlier events` | `surface.js:303` |
| `assistant/message` may not cite sources | `assistant/message embeds its source stream and cannot carry sourceEventSeqs` | `surface.js:233` |
| `sourceEventSeqs` must be an array | `sourceEventSeqs on event at seq ${event.seq} must be an array when present` | `surface.js:238` |
| `sourceEventSeqs` must not be empty | `sourceEventSeqs must not be empty` | `surface.js:241` |
| seqs must be non-negative safe ints | `session event "${event.type}" sourceEventSeqs must densely contain non-negative safe integers` | `surface.js:246` |
| no duplicates | `sourceEventSeqs must not contain duplicates` | `surface.js:253` |
| must be strictly earlier | `sourceEventSeqs must reference earlier events: ${nonEarlierSource} >= current seq ${event.seq}` | `surface.js:256` |
| **must cover every shadowed node** | `surface replace: sourceEventSeqs must include every shadowed surface node; missing ${missing.join(', ')}` | `surface.js:261` |

`DSH/dsh-session/lib/types/surface.js:309-327` — `replacementRange()`:

```ts
function replacementRange(state, op) {
    const startIdx = state.nodes.indexOf(op.startSeq);
    if (startIdx === -1) {
        throw new Error(`surface replace: start seq ${op.startSeq} not found in surface`);
    }
    const endIdx = state.nodes.indexOf(op.endSeq);
    if (endIdx === -1) {
        throw new Error(`surface replace: end seq ${op.endSeq} not found in surface`);
    }
    if (startIdx > endIdx) {
        throw new Error(`surface replace: start seq ${op.startSeq} (index ${startIdx}) is after end seq ${op.endSeq} (index ${endIdx})`);
    }
    return {
        startIdx,
        endIdx,
        shadowedSeqs: state.nodes.slice(startIdx, endIdx + 1),
    };
}
```

##### B.5.5 `startSeq` / `endSeq` / `shadowed*` semantics — precise

- `startSeq`, `endSeq` are **surface-node seqs**, not log seqs. They must be *current* members of `state.nodes` (the live surface list), i.e. they must NOT already have been shadowed by an earlier replacement. A shadowed node is no longer in `state.nodes`, so a second replacement targeting it throws `not found in surface`.
- `startSeq` and `endSeq` are **inclusive**; `startSeq === endSeq` replaces exactly one node.
- `endSeq` must be **at or after** `startSeq` **in surface order** (not numeric order — `indexOf` comparison).
- `shadowedSeqs` is **derived**, not supplied: it is `state.nodes.slice(startIdx, endIdx + 1)` — "Actual surface entries removed by the operation, in surface order." (`dsh-session/lib/types/surface.d.ts:105-106`).
- The **`shadowedRange` / `shadowedSeqs` / `shadowedTokenCount` fields belong to the `compaction/prune` EVENT PAYLOAD**, not to `surfaceOp`. `surfaceOp` has exactly three keys in the `replace` form (`op`, `startSeq`, `endSeq`) — enforced by `isReplaceOp()` requiring `Object.keys(op).length === 3` (`surface.js:190-199`).

##### B.5.6 `tool/result` replacement is STRICTLY content-only — the plugin's exact use case

`DSH/dsh-session/lib/types/surface.js:349-375`:

```ts
/** Restrict a tool-result replacement to one current result's content. */
function assertToolResultRewrite(event, shadowedSeqs, read) {
    if (event.type !== 'tool/result')
        return;
    if (shadowedSeqs.length !== 1) {
        throw new Error('tool/result surface replacement must rewrite exactly one current node');
    }
    for (const originalSeq of shadowedSeqs) {
        const original = read(originalSeq);
        if (original?.type !== 'tool/result') {
            throw new Error('tool/result surface replacement must target a current tool/result');
        }
        const originalRest = { ...original.data };
        const replacementRest = { ...event.data };
        originalRest['message'] = { ...original.data.message, content: null };
        replacementRest['message'] = { ...event.data.message, content: null };
        if (!isDeepEqualJson(originalRest, replacementRest)) {
            throw new Error('tool/result surface replacement may change only content');
        }
    }
}
```

**Contract summary for `tool/result` replacement:** exactly **one** shadowed node; the target must currently be a `tool/result`; and the replacement may change **ONLY** `data.message.content` — every other field of `data` (including `turn`, `step`, `error`, `meta`) must be byte-identical (deep-equal) to the original.

##### B.5.7 System-prompt head protection

`DSH/dsh-session/lib/types/surface.js:376-390` — a replacement covering surface node 0 must itself be a `system/message` over exactly that one node: `surface replace: node 0 holds the system prompt and may be rewritten only by a system/message over exactly that node`. Later system nodes are unprotected.

##### B.5.8 How the surface actually re-materializes (the consumer)

**Two layers:**

**(a) Live `Session` — `SurfaceManager`** (`DSH/dsh-session/lib/types/surface.d.ts:143-186`). The Session owns `private readonly surfaceManager: SurfaceManager` (`dsh-session/lib/types/index.d.ts:146-149`). On every append, `Session.#appendEvents` calls `this.surfaceManager.prepareBatch(events)` **before** pushing to the log, then `acceptSurface()` after the log push (`dsh-session/lib/types/index.js:663-673`):

```js
        const acceptSurface = this.surfaceManager.prepareBatch(events);
        if (entry !== undefined)
            entry.appending = true;
        try {
            const publications = entry === undefined ? [] : events.map((event) => {
                ...
            });
            for (const event of events)
                this.log.push(event);
            this.eventsSnapshot = undefined;
            acceptSurface();
```

So the surface transition is **validated before** the log changes and **committed after** — an invalid `surfaceOp` fails the append, leaving the log unchanged.

**(b) Replay — `foldSurface()`** (`dsh-session/lib/types/surface.d.ts:134-141`):

```ts
/**
 * Replay a complete session log through the canonical surface fold.
 * @param events - session events in contiguous seq order.
 * @param projections - pure interpreters for plugin-owned message changes; required definitions must be supplied.
 * @returns detached current sequences and replacement history.
 * @throws when an interpreter is missing or an event violates its projection, surface metadata, source attribution, or replacement rules.
 */
export declare function foldSurface(events: readonly SessionEvent[], projections?: readonly SessionMessageProjection[]): SurfaceFoldResult;
```

The fold transition itself (`surface.js:438-455`):

```js
function applySurfacePlan(state, plan) {
    if (plan?.kind === 'append') {
        state.nodes.push(plan.seq);
    }
    else if (plan?.kind === 'replace') {
        state.nodes.splice(plan.startIdx, plan.endIdx - plan.startIdx + 1, plan.seq);
        state.replaceGeneration += 1;
        state.contentGeneration += 1;
    }
    ...
```

**So: a `replace` literally splices the surface node list, removing the shadowed range and inserting the replacement's own seq at that position.** The log is NOT rewritten — the shadowed events remain in the append-only log; they are only excluded from the model-visible surface.

**(c) The model-visible messages** are produced by `deriveEventMessage(event, projectedMessages?)` (`dsh-session/lib/types/surface.d.ts:76-88`) and `Session.deriveMessages()` (`dsh-session/lib/types/index.d.ts:371`).

**Critical corollary for a human transcript** — `dsh-session/lib/types/surface.d.ts:50-60`:

> Narrow an event to an append-origin surface event: one that entered the surface at its own log position and was never itself a replacement copy.
> The model-visible surface deliberately shadows replaced ranges, so it is the wrong source for a human transcript — a landed replacement would erase conversation the user already saw. Append-origin events are that transcript's durable source material; replacement copies stay model-only.

**Real-log proof (root session `session-a86ca5f6-a254-4bb9-a940-f2cf3e70cb08`):** seq 892 is a `user/message` with `surfaceOp = {op:'replace', startSeq:19, endSeq:883}` and `sourceEventSeqs` listing **every** shadowed node (19…883) plus the two compaction source seqs (889, 891) — i.e. the compaction producer cites the full shadowed set exactly as the contract demands.

##### B.5.9 The sibling producer — `dsh-compaction-tool-result-pruner` (verbatim)

`DSH/dsh-compaction-tool-result-pruner/lib/index.js:159-177`:

```js
			session.append("compaction/prune", {
				shadowedRange: {
					start: seq,
					end: seq
				},
				shadowedSeqs: [seq],
				shadowedTokenCount: this.ctx.tokenMeter.estimateMessage(original)
			});
			const replacement = session.append("tool/result", {
				...event.data,
				message
			}, {
				surfaceOp: {
					op: "replace",
					startSeq: seq,
					endSeq: seq
				},
				sourceEventSeqs: [seq]
			});
```

Marker constant, verbatim (`dsh-compaction-tool-result-pruner/lib/index.js:7-8`):

```js
/** Fixed marker substituted for every removed middle span. */
const PRUNE_MARKER = "\n\n[... tool result middle pruned ...]\n\n";
```

Its producer doc (`dsh-compaction-tool-result-pruner/lib/index.js:125-136`):

```js
	/**
	* Prune every over-budget tool result from one stable current-surface snapshot.
	* Each replacement preserves the complete event data except for `content`,
	* cites the shadowed node so replay can recover the replacement input, and is
	* immediately preceded by a `compaction/prune` shadow-price event pricing the
	* shadowed node through the injected token meter, so pure consumers can
	* subtract it without per-node state.
	* @param session - session whose current surface is rewritten.
	* @returns landed replacements and aggregate Unicode-code-point savings.
	* @throws when the session rejects a replacement; replacements committed
	* earlier in the pass remain durable.
	*/
```

**THE MEASUREMENT BUG — CONFIRMED BY SOURCE:** the plugin's `applyTiering()` writes **the exact same event shape**:

`/home/minami/Workspace/projects/dsh-workspace/dsh-plugins/dsh-tokeneconomizer/lib/index.js:871-880`:

```js
      try {
        session.append('compaction/prune', {
          shadowedRange: { start: seq, end: seq },
          shadowedSeqs: [seq],
          shadowedTokenCount: shadowTokens,
        })
        session.append('tool/result', { ...event.data, message }, {
          surfaceOp: { op: 'replace', startSeq: seq, end: seq },
          sourceEventSeqs: [seq],
        })
```

Byte-for-byte the same shape as the pruner. Both write a `compaction/prune` **immediately followed by** a `tool/result` replacement over the **same single node** (`startSeq === endSeq === seq`). A consumer that identifies "a prune happened" by event shape **cannot distinguish the plugin's tiering from the pruner's pruning** — this is the documented measurement bug.

**Real-log confirmation:** `session-c6e16f8d-672d-4900-bbfc-3e6225bda136` seq 888 = `compaction/prune {shadowedRange:{start:31,end:31}, shadowedSeqs:[31], shadowedTokenCount:1342}`, and seq 889 = `tool/result` with `surfaceOp={op:'replace',startSeq:31,endSeq:31}`, `sourceEventSeqs=[31]` — the exact adjacent-pair protocol. (2052 `compaction/prune` events observed across the 350-log corpus.)

##### B.5.10 The shadow-price protocol is CONTRACTUAL, and the plugin satisfies it

`dsh-compaction/lib/types/types.d.ts:80-88` (verbatim, quoted in B.3.5):

> The shared shadow-price protocol: a surface `replace` event is priced by the metering event immediately before it (`compaction/summary` for a summarizing compaction, **this event for a prune**), which states the heuristic token price of the exact replaced range so a pure consumer can subtract it without retaining per-node prices. **The replacement MUST be appended synchronously right after this event.**

The plugin appends `compaction/prune` then immediately `tool/result` — **synchronously, in the same tick, with no intervening append** (`lib/index.js:872-880`). Compliant.

##### B.5.11 `Session.append` — the runtime vs type mismatch

**Type declaration** (`dsh-session/lib/types/index.d.ts:259`):

```ts
    append(inputs: readonly SessionEventInput[]): readonly SessionEvent[];
```

**Runtime implementation** (`dsh-session/lib/types/index.js:630-640`):

```js
    append(type, data, ...opts) {
        if (typeof type !== 'string')
            return this.#appendEvents(type);
        this.publicationEntry();
        const snapshot = snapshotAppend(type, data, opts[0], `session event "${type}"`);
        // Payload getters can detach the Session while the snapshots are read.
        const entry = this.publicationEntry();
        const event = createAppendEvent(snapshot, SessionSeq(this.log.length));
        this.commit(event, entry);
        return event;
    }
```

**The runtime `append(type, data, opts)` single-event form — the exact form the plugin and the pruner use — is NOT in the `.d.ts`.** The `.d.ts` only declares the **array-batch** form `append(inputs: readonly SessionEventInput[])`. The single form exists at runtime (and in the `index.js` JSDoc at `dsh-session/lib/types/index.d.ts:260-300`), but the *declaration* is missing. (See B.9 G-B-05.)

Also note the runtime's `append` accepts `opts` as `opts[0]` — the **third** positional argument. The plugin passes exactly that: `session.append('tool/result', {...}, { surfaceOp, sourceEventSeqs })`.


---

### 3.6 Lifecycle hook signatures

#### B.6 Lifecycle hook signatures

##### B.6.1 The table

| Event | Exact signature | `@mode` | Scope filtering | Returns | Declared at |
|---|---|---|---|---|---|
| `agent/created` | `(payload: { agent: Agent; source: SessionStartSource; signal?: AbortSignal })` | **serial** | agent-scoped (`this: Scoped<Agent>`) | `undefined \| Promise<undefined>` | `dsh-agent/lib/types/runtime-types.d.ts:255-259` |
| `agent/disposed` | `(payload: { agent: Agent })` | **emit** | agent-scoped | `void` | `dsh-agent/lib/types/runtime-types.d.ts:268-270` |
| `agent/request` | `(payload: { agent: Agent; turn: number; step: number; signal: AbortSignal }, next: () => Promise<LlmCallConfig>)` | **waterfall** | agent-scoped | `Promise<LlmCallConfig>` | `dsh-agent/lib/types/runtime-types.d.ts:363-368` |
| `agent/assistant-stream` | `(payload: { agent: Agent; frame: AssistantStreamFrame })` | **emit** | agent-scoped | `void` | `dsh-agent/lib/types/runtime-types.d.ts:402-405` |
| `session/event` | `(session: Session, event: SessionEvent)` | **emit** | session-owner-scoped | `void` | `dsh-session/lib/types/index.d.ts:66` |
| `tools/result` | `(exec: Readonly<ToolExecution>, result: Readonly<ToolExecutionResult>)` | **emit** | **keyed by `exec.agent`** | `undefined` | `dsh-tools/lib/types/events.d.ts:48` |
| `tools/post-execute` | `(exec: ToolExecution, result: Readonly<ToolExecutionResult>, next: () => Promise<PostToolDecision>)` | **waterfall** | agent-scoped ("agent-scoped listeners receive only that agent's calls") | `Promise<PostToolDecision>` | `dsh-tools/lib/types/events.d.ts:40` |

##### B.6.2 Verbatim declarations

**`agent/created`** — `dsh-agent/lib/types/runtime-types.d.ts:242-259`:

```ts
        /**
         * An entered agent is ready for per-agent initialization after factory setup.
         * Listeners run in order and are awaited before creation resolves. AgentLoop
         * holds queued input until all listeners finish. A throw or rejection fails
         * creation and skips later listeners. Disposal retains the scope and session
         * until dispatch settles; listeners must not await agent.whenIdle() or their
         * own owner's disposal.
         * @param payload.agent - the newly registered agent with its live session and completed setup.
         * @param payload.source - fresh creation, resume, clear, or compaction source.
         * @param payload.signal - factory initialization cancellation signal, when provided.
         * Scope-filtered dispatch (`@deepseek-ai/dsh-scope`): agent-scoped listeners receive only that agent.
         * @mode serial
         */
        'agent/created'(this: Scoped<Agent>, payload: {
            agent: Agent;
            source: SessionStartSource;
            signal?: AbortSignal;
        }): undefined | Promise<undefined>;
```

> **"A throw or rejection fails creation and skips later listeners."** — The plugin's `agent/created` handler is `async` and awaits `start(state, source)` (the Python-engine launch) at `lib/index.js:613`. A rejection there **fails agent creation for the whole session**. The plugin wraps engine work in try/catch internally in some paths but `await start(state, source)` at line 613 is a bare await.

**`SessionStartSource`** — `dsh-agent/lib/types/runtime-types.d.ts:130`:

```ts
export type SessionStartSource = 'startup' | 'resume' | 'clear' | 'compact';
```

**`agent/disposed`** — `dsh-agent/lib/types/runtime-types.d.ts:260-270`:

```ts
        /**
         * An agent left the registry; AgentLoop emits this after driver quiescence
         * and scoped-registration unwind, but before session detachment. Custom
         * registry users own their driver-ordering contract.
         * @param payload.agent - the exact agent removed from the registry.
         * Scope-filtered dispatch (`@deepseek-ai/dsh-scope`): agent-scoped listeners receive only that agent.
         * @mode emit
         */
        'agent/disposed'(this: Scoped<Agent>, payload: {
            agent: Agent;
        }): void;
```

**`agent/request`** — `dsh-agent/lib/types/runtime-types.d.ts:341-368`:

```ts
        /**
         * Replace the frozen call configuration. `await next()` yields the config
         * the machine would use (the step's model selection with agent options on the
         * first request, the logged header's controls afterwards); a
         * replacement may adjust controls but must keep the provider, model, and
         * reasoning effort selection. On step admission,
         * this runs after assembly and `step/start`, before the system prompt and
         * accepted user batch are committed. Cancellation here or during subsequent
         * `prepareCall()` resolution commits neither. The prepared call capability
         * governs prompt admission. Model-visible content must use logged channels;
         * this waterfall cannot mutate messages.
         * @deprecated Retained for existing listeners; do not add new listeners.
         * Use agent.model.select() before step preparation for model and reasoning
         * choices, and AgentOptions.maxTokens for the output cap. Other per-request
         * control overrides have no replacement API.
         * @param payload.agent - the agent making the model call.
         * @param payload.turn - the open turn number.
         * @param payload.step - the step whose request this is.
         * @param payload.signal - the current turn's explicit abort signal.
         * Scope-filtered dispatch (`@deepseek-ai/dsh-scope`): agent-scoped listeners receive only that agent.
         * @mode waterfall
         */
        'agent/request'(this: Scoped<Agent>, payload: {
            agent: Agent;
            turn: number;
            step: number;
            signal: AbortSignal;
        }, next: () => Promise<LlmCallConfig>): Promise<LlmCallConfig>;
```

> **`agent/request` is `@deprecated`**: "Retained for existing listeners; **do not add new listeners.**" The plugin registers one at `lib/index.js:686` and uses it as the trigger for `applyTiering(state)` (line 692). This is a **deprecated-API dependency** — a documented future-removal risk. (See G-B-06.)

**`agent/assistant-stream`** — `dsh-agent/lib/types/runtime-types.d.ts:393-405`:

```ts
        /**
         * Process-local assistant-stream publication. Chunk frames are transient;
         * the loop appends one final v2 `assistant/message` or `assistant/attempt`
         * with the same stream before a committed end frame.
         * @param payload.agent - the agent whose attempt produced the frame.
         * @param payload.frame - one ordered start, chunk, or end publication.
         * Scope-filtered dispatch (`@deepseek-ai/dsh-scope`): agent-scoped listeners receive only that agent.
         * @mode emit
         */
        'agent/assistant-stream'(this: Scoped<Agent>, payload: {
            agent: Agent;
            frame: AssistantStreamFrame;
        }): void;
```

> "**Process-local** assistant-stream publication." — This hook is NOT a session event; it never reaches the log. The plugin uses it only for watchdog progress (`lib/index.js:627-631`).

**`session/event`** — `dsh-session/lib/types/index.d.ts:53-66`:

```ts
        /**
         * Post-commit, fire-and-forget append feed. The listener snapshot resolves
         * before the log push, but callbacks run after it; observer failures are
         * logged and contained without making the committed append fail.
         * Array append commits every member before publishing them in order;
         * `session.seq` and `session.surface` already include the complete batch.
         * `session.currentBatchPublication` identifies the member being delivered.
         * Scope-filtered dispatch (`@deepseek-ai/dsh-scope`): agent-scoped listeners
         * receive events from sessions entered through that agent's context.
         * @param session - the session whose log grew.
         * @param event - the appended event, exactly as recorded.
         * @mode emit
         */
        'session/event'(this: Scoped<Session>, session: Session, event: SessionEvent): void;
```

> **`session/event` fires AFTER the log push and AFTER `acceptSurface()`** — so `session.surface` already reflects the new event when the plugin's handler runs. The plugin relies on this: `applyTiering` reads `session.surface.nodes` (line 832).

**`tools/result`** — `dsh-tools/lib/types/events.d.ts:41-48`:

```ts
        /**
         * Observe the frozen, lossless-JSON final outcome. Listener failures are contained.
         * Scope-filtered dispatch (`@deepseek-ai/dsh-scope`): keyed by `exec.agent`.
         * @param exec - the execution object that traversed the pipeline.
         * @param result - a deep-frozen snapshot of the final returned result.
         * @mode emit
         */
        'tools/result'(this: Scoped<ToolsService>, exec: Readonly<ToolExecution>, result: Readonly<ToolExecutionResult>): undefined;
```

**`tools/post-execute`** — `dsh-tools/lib/types/events.d.ts:29-40`:

```ts
        /**
         * Accept, replace, enrich, or block a normalized dispatch result. `next()`
         * accepts it unchanged; thrown tools still reach this waterfall as errors. Async
         * listeners must observe `exec.signal`; after they settle, caller
         * cancellation replaces only a successful accepted outcome with the code
         * selected by whether the tool body was invoked.
         * Scope-filtered dispatch (`@deepseek-ai/dsh-scope`): agent-scoped listeners receive only that agent's calls.
         * @param exec - the call that just ran (name, parsed arguments, caller agent).
         * @param result - the dispatch outcome a listener may accept, replace, or block.
         * @mode waterfall
         */
        'tools/post-execute'(this: Scoped<ToolsService>, exec: ToolExecution, result: Readonly<ToolExecutionResult>, next: () => Promise<PostToolDecision>): Promise<PostToolDecision>;
```

##### B.6.3 Scope filtering — the plugin's dual-registration pattern

The plugin registers **both** a plugin-root listener and an **agent-scoped** listener on `agent.ctx`:

| Listener | Registration site | Scope |
|---|---|---|
| `ctx.on('tools/result', ...)` | `lib/index.js:516` (diagnostics only, `diagOn` guard) | plugin root — **unscoped** |
| `ctx.on('tools/post-execute', ...)` | `lib/index.js:520` (diagnostics only) | plugin root — **unscoped** |
| `state.agent.ctx.on('tools/post-execute', ...)` | `lib/index.js:665` | agent-scoped |
| `state.agent.ctx.on('session/event', ...)` | `lib/index.js:682` | agent-scoped |
| `state.agent.ctx.on('agent/request', ...)` | `lib/index.js:686` | agent-scoped |
| `state.agent.ctx.on('tools/result', ...)` | `lib/index.js:699` | agent-scoped |
| `ctx.on('agent/created', ...)` | `lib/index.js:527` | plugin root |
| `ctx.on('agent/disposed', ...)` | `lib/index.js:616` | plugin root |
| `ctx.on('agent/assistant-stream', ...)` | `lib/index.js:627` | plugin root |

The plugin's own comment at `lib/index.js:512-514` states the intent:

> The harness dispatches the tool events through a scope carrier. These two root-level listeners are the routing verification: they count what a listener on the plugin's own context receives, next to the counts of the agent-scoped listeners above.

**The plugin also defends against cross-agent bleed** with identity checks, because scope filtering alone is not trusted:
- `lib/index.js:675`: `if (exec.agent && String(exec.agent.id) !== state.sid) return decision`
- `lib/index.js:687`: `if (payload.agent !== state.agent) return next()`
- `lib/index.js:1201`: `if (exec.agent && String(exec.agent.id) !== state.sid) return`

**Gap:** `session/event` (line 682) has **NO identity guard** — it uses `onEvent(state, session, event)` and ignores the `_session` parameter (the underscore prefix in the signature at `lib/index.js:771`: `function onEvent(state, _session, event)`). If the agent-scope carrier ever delivers another session's events, the plugin would attribute them to the wrong agent. The `tools/*` and `agent/request` handlers all guard; `session/event` does not.

##### B.6.4 Disposer contract

Cordis `ctx.on(...)` returns a disposer. The plugin registers all listeners on `state.agent.ctx` (the **agent-scoped** context) — `Agent.ctx` doc: "Agent-scoped context; its contributions are agent-local, **unwind on disposal**, and reject registration afterward." (`dsh-agent/lib/types/runtime-types.d.ts:175-176`). So agent-scoped listeners are torn down automatically on agent disposal.

The plugin's root-level listeners (`ctx.on('agent/created')`, `ctx.on('agent/disposed')`, `ctx.on('agent/assistant-stream')`) live for the plugin's lifetime — correct, since the plugin must see every agent. `agent/disposed` handler at `lib/index.js:616-623` clears the timer and the watchdog.

**Ordering constraint (plugin's own comment, `lib/index.js:608-610`):**

> Every observer is registered before the first await: `agent/created` is awaited before the loop claims its first message, so a listener registered after the brief would miss the session's first tool calls.


---

### 3.7 Public vs internal Agent/Session surface

#### B.7 Public vs internal Agent/Session surface

##### B.7.1 What the plugin calls vs what the types declare

| Plugin call site | Member | Declared? | Declared at | Status |
|---|---|---|---|---|
| `lib/index.js:528` | `agent.session.header.origin` | **yes** | `dsh-agent/lib/types/runtime-types.d.ts:168` (`readonly session: Session`) → `dsh-session/lib/types/index.d.ts:158` (`readonly header: SessionHeader`) → `dsh-session/lib/types/types.d.ts:86` | **public** |
| `lib/index.js:546` | `agent.session.header.cwd` | **yes** | `dsh-session/lib/types/types.d.ts:70` | **public** |
| `lib/index.js:545` | `agent.id` | **yes** | `dsh-agent/lib/types/types.d.ts:14` (`readonly id: SessionId`) | **public** |
| `lib/index.js:832` | `session.surface.nodes` | **yes** | `dsh-session/lib/types/index.d.ts:149` (`get surface(): SessionSurface`) → `dsh-session/lib/types/surface.d.ts:120` (`readonly nodes: readonly SessionSeq[]`) | **public** |
| `lib/index.js:837` | `session.eventAt(seq)` | **yes, but `@deprecated`** | `dsh-session/lib/types/index.d.ts:221` | **deprecated** |
| `lib/index.js:847` | `session.deriveEventMessage(event)` | **yes** | `dsh-session/lib/types/index.d.ts:378` | **public** |
| `lib/index.js:925` | `session.deriveMessages()[0]` | **yes** | `dsh-session/lib/types/index.d.ts:371` | **public** |
| `lib/index.js:748` | `session.snapshotEvents()` | **yes, but `@deprecated`** | `dsh-session/lib/types/index.d.ts:232` | **deprecated** |
| `lib/index.js:1286` | `session.snapshotEvents()` | **yes, but `@deprecated`** | `dsh-session/lib/types/index.d.ts:232` | **deprecated** |
| `lib/index.js:1285` | `session.header` | **yes** | `dsh-session/lib/types/index.d.ts:158` | **public** |
| `lib/index.js:872,877` | `session.append('compaction/prune', data)` / `session.append('tool/result', data, {surfaceOp, sourceEventSeqs})` | **runtime only** | single-event `append` is **absent** from the `.d.ts` (only the array-batch form is declared at `dsh-session/lib/types/index.d.ts:259`) | **UNDECLARED / internal** |
| `lib/index.js:663,726` | `agent.ctx.systemPrompt.section(...)` / `.context(...)` | agent-scoped `ctx` is declared (`runtime-types.d.ts:176`) but `systemPrompt` submodule access is **not in the Agent type** | — | **UNVERIFIABLE** — `ctx.systemPrompt` is a Cordis service property, not declared on `Agent` |
| `lib/index.js:739` | `state.agent.ctx.tools.restrict({ deny })` | same | — | **UNVERIFIABLE** — same reason |
| `lib/index.js:719,737` | `ctx.tools.definitions()` | plugin-root `ctx` | — | **UNVERIFIABLE** — `ctx.tools` is a Cordis service property |

##### B.7.2 Deprecation notices — verbatim

`eventAt` (`dsh-session/lib/types/index.d.ts:214-221`):

```ts
    /**
     * Return the immutable event stored at one exact sequence number.
     * @deprecated Existing logic may remain unmigrated for now, but new calls are prohibited.
     * See the Agent Note: .agents/notes/implemented/architecture/2026-09-09-deprecate-synchronous-session-event-reads.md.
     * @param seq - event sequence number.
     * @returns the accepted event, or undefined when the log does not contain it.
     */
    eventAt(seq: SessionSeq): SessionEvent | undefined;
```

`snapshotEvents` (`dsh-session/lib/types/index.d.ts:222-232`):

```ts
    /**
     * Materialize an immutable snapshot of a half-open event sequence range.
     * A full current snapshot is reused until the next append; every previously
     * returned snapshot remains stable after later appends.
     * @deprecated Existing logic may remain unmigrated for now, but new calls are prohibited.
     * See the Agent Note: .agents/notes/implemented/architecture/2026-09-09-deprecate-synchronous-session-event-reads.md.
     * @param fromSeq - non-negative inclusive sequence number; defaults to the log start.
     * @param toSeqExclusive - non-negative exclusive sequence number; defaults to the current end.
     * @returns a frozen array of the selected deeply frozen events.
     */
    snapshotEvents(fromSeq?: SessionLogOffset, toSeqExclusive?: SessionLogOffset): readonly SessionEvent[];
```

`ownEvents` (`dsh-session/lib/types/index.d.ts:233-239`) is likewise `@deprecated`.

> The plugin's `applyTiering` uses `session.eventAt(seq)` (`lib/index.js:837`) and `session.snapshotEvents()` (`lib/index.js:748`, `1286`) — **all three deprecated reads** whose doc says "**new calls are prohibited**". The plugin's use is "existing logic [that] may remain unmigrated for now", so it is not currently a violation, but it is a **migration debt** that a future DSH release will break.

##### B.7.3 What is NOT on the Session but the plugin might want

- **`session.header` does NOT contain** the exact inherited prefix length. `session.inheritedEventCount` (`dsh-session/lib/types/index.d.ts:160`) holds it, and the header doc says so: "The exact prefix length is Session state rather than ordinary header metadata." (`dsh-session/lib/types/types.d.ts:78-80`).
- **`session.header` does NOT contain** the compaction lineage, the turn/step counter, the model selection, the inbox state, or the child descriptor. All of those are separate events or projections.
- The plugin's `state.turn` is maintained from `turn/start` events (`lib/index.js:774`, `937`), not from the session — correct, because no header carries it.

##### B.7.4 `Session.append` — declared vs runtime (again, this is the sharpest one)

- Declared: `append(inputs: readonly SessionEventInput[]): readonly SessionEvent[];` (`dsh-session/lib/types/index.d.ts:259`)
- Runtime: `append(type, data, ...opts)` (`dsh-session/lib/types/index.js:630`)
- The `.js` JSDoc for the single form is present at `dsh-session/lib/types/index.d.ts:260-300`, but **no `.d.ts` overload declares it**.

INFERRED: the `.d.ts` was generated from an older signature, and the single-event form was added to the runtime without a matching declaration. A TypeScript consumer importing `Session` cannot call `session.append('tool/result', data, { surfaceOp })` without a type error. The plugin is plain JavaScript ("Zero runtime imports outside node: builtins" — `package.json` description), so it is unaffected at runtime — but this is the exact shape the plugin depends on.

---

### 3.8 Services the plugin may consume

#### A.4 Service scoping keys

| Service | Package | Scoping key | Match type | Evidence |
|---|---|---|---|---|
| `ctx.sessionQuery` (logical sessions) | `dsh-session-query` | `header.cwd` | **exact string equality** | `dsh-session-query/lib/index.js:792` — `case "cwd": return (record) => filter.values.includes(record.header.cwd ?? null);` |
| `ctx.sessionQuery` (SQLite backend) | `dsh-session-query-sqlite` | `sessions.cwd` column | **exact `IN (…)`** | `dsh-session-query-sqlite/lib/index.js:217-218` — `case "cwd": addNullableList(clauses, params, "cwd", filter.values);` |
| `ctx.workspaceRegistry` | `dsh-workspace` | `fs.realpath(cwd)` | **exact string equality** | `dsh-workspace/lib/index.js:643-645` |
| `ctx.sessionProjections` | `dsh-session-projection` | **session id** | per-session state; **no project axis** | `dsh-session-projection/lib/index.js:129-144` — projections are registered per `key` with a `stateVersion`; no cwd/workspace parameter in the registration API |
| `ctx.workingDirectory` | `dsh-working-directory` | session-scoped mutable cwd | n/a | `dsh-working-directory/lib/index.js:56-57` — `init: (header) => header.cwd ?? null`, `apply: (state, event) => event.type === "working-directory/change" ? event.data.cwd : state` |
| `ctx.sessions` | `dsh-session` | session id | exact | `dsh-session/lib/types/index.js:919` — `super(ctx, 'sessions')` |
| `ctx.schedule` | `dsh-schedule` | `create.cwd` → workspace attach | exact (realpath canon) | `dsh-schedule/lib/index.js:1478,1504,1510-1514` — `await this.joinWorkspace(sessionId, target.create.cwd)` → `registry.resolveByPath(cwd)?.attachSession(sessionId)` |
| `ctx.jobs` | `dsh-jobs` / `dsh-jobs-local` | **no cwd/project axis found** | — | `grep -rn "cwd" --include=*.js dsh-jobs/lib/ dsh-jobs-local/lib/` → **0 hits** (only "projection" in the sense of client view) |
| `ctx.goal` | `dsh-goal` | **no cwd/project axis found** | — | `grep -rn "cwd" --include=*.js dsh-goal/lib/` → **0 hits** outside the auto-generated `typert.host.js` event-map string (`dsh-goal/lib/typert.host.js:1139`, `:1147`); goal state is a pure fold over events |
| team tasks (`ctx.agentTeam` / team task board) | `dsh-agent-team` | **session/team id**; no cwd axis found | — | `dsh-agent-team/lib/types/index.js:67` — `static inject = ['agents','sessions','sessionPersistence','sessionProjections','subagents']` — no workspace/cwd service; `grep -rn "cwd" dsh-agent-team/lib/` → 0 hits outside `typert.host.js:585`, `:593` |

**Consequence (measured):** `sessionQuery`'s `cwd` filter is **exact-match on the raw header
string**, with no prefix or subtree semantics. There is **no** DSH service that answers "all
sessions under directory X". A plugin that wants subtree scope must enumerate candidate cwds
itself — which is exactly what the plugin does with `repoKeyFor` (A.5/A.6).

### 3.9 Seam stability tiers and drift surface

#### C.1 Seam stability tiers

**Tier legend.** `CONTRACT` = the seam/method appears in a published `lib/types/*.d.ts` of the owning package (the package's `exports` map `types` → that file). `SRC-ONLY` = it exists only in `src/*.ts` (internal implementation, no published declaration). `DOC` = named in `<dsh>/docs/`. `DEP` = explicitly deprecated upstream.

| Seam the plugin uses | Plugin site | Declared where | Stability | Evidence |
|---|---|---|---|---|
| `agent/created` (`{ agent, source, signal? }`) | `index.js:527` | `dsh-agent/lib/types/runtime-types.d.ts:255-259` — `declare module '@deepseek-ai/cordis' { interface Events { 'agent/created'(...) } }` | **CONTRACT** (typed) | payload `agent: Agent; source: SessionStartSource; signal?: AbortSignal`; `source` is "fresh creation, resume, clear, or compaction source" |
| `agent/disposed` (`{ agent }`) | `index.js:616` | `dsh-agent/lib/types/runtime-types.d.ts:269-272` | **CONTRACT** (typed) | `payload.agent` — "the exact agent removed from the registry" |
| `agent/assistant-stream` | `index.js:627` | `dsh-agent/lib/types/runtime-types.d.ts:402` — `'agent/assistant-stream'(this: Scoped<Agent>, payload: { agent: Agent; frame: AssistantStreamFrame }): void` | **CONTRACT** (typed) | the plugin destructures only `{ agent }` (`index.js:627`), which is the stable part of the payload |
| `agent/request` (`{ agent, turn, step, signal }`) | `index.js:686-698` | `dsh-agent/lib/types/runtime-types.d.ts:363-368` — typed, **but upstream-deprecated** | **CONTRACT + DEP** | `<dsh>/docs/upgrade-guide/v0.2.1-alpha.4/session-model-selection/guide.md:16`: "`agent/request` is deprecated. Existing listeners still run on each main-loop request attempt and can adjust other controls, but cannot change provider or model, or add, change, or clear reasoning effort." Also `<dsh>/docs/architecture.md:114`: "the deprecated `agent/request` hook adjusts controls without changing the provider, model, or effort selection" |
| `tools/post-execute` (`exec, result, next`) | `index.js:665-681` (agent-scoped), `index.js:520` (root-scoped) | `dsh-tools/lib/types/events.d.ts:40` | **CONTRACT** (typed) | `(this: Scoped<ToolsService>, exec: ToolExecution, result: Readonly<ToolExecutionResult>, next: () => Promise<PostToolDecision>): Promise<PostToolDecision>` |
| `tools/result` (`exec, result`) | `index.js:699`, `index.js:516` | `dsh-tools/lib/types/events.d.ts:48` | **CONTRACT** (typed) | `(this: Scoped<ToolsService>, exec: Readonly<ToolExecution>, result: Readonly<ToolExecutionResult>): undefined` |
| `session/event` (`session, event`) | `index.js:682` | `dsh-session/lib/types/index.d.ts:66` — `'session/event'(this: Scoped<Session>, session: Session, event: SessionEvent): void` (`@mode emit`) | **CONTRACT** (typed) | payload is the typed `SessionEvent` union; the **type-key set** the plugin matches on is the real assumption, not the event name |
| `agent/inbox/spliced` | `index.js:349` (`isOwnNotice`) | `dsh-agent/lib/types/types.d.ts:97` — `'agent/inbox/spliced': { … }` in `SessionEventMap` | **CONTRACT** (typed) | the plugin reads `data.inserted[].source.kind` (`index.js:352-355`) |
| `session.append(type, data, opts)` with `surfaceOp` | `index.js:872-880` | `dsh-session/lib/types/index.d.ts:259` (array overload) + the single-event overload docblock; `surfaceOp` typed at `dsh-session/lib/types/types.d.ts:476` | **CONTRACT** (typed, **overloaded**) | `append(inputs: readonly SessionEventInput[]): readonly SessionEvent[]`; `surfaceOp?: never` for non-surface types (`types.d.ts:521`) |
| `Session.surface.nodes` | `index.js:832` | `dsh-session` types; `surface` is a `SurfaceOp`-bearing projection | **CONTRACT** | `dsh-session/lib/types/types.d.ts:476` `surfaceOp: SurfaceOp` |
| `Session.eventAt(seq)` / `snapshotEvents()` / `deriveEventMessage()` / `deriveMessages()` | `index.js:837`, `1286`, `847`, `925` | `dsh-session/lib/types/index.d.ts:221` (`eventAt`), `:232` (`snapshotEvents`); `deriveEventMessage` exported from `dsh-session/lib/types/index.d.ts:23` | **CONTRACT** (typed) | `eventAt(seq: SessionSeq): SessionEvent \| undefined`; `snapshotEvents(fromSeq?, toSeqExclusive?): readonly SessionEvent[]` |
| `Session.header` (`.id`, `.cwd`, `.origin`) | `index.js:546`, `528`, `1285`; `bridge.js:219` | `dsh-session/lib/types/types.d.ts:66,70,86` | **CONTRACT** (typed) | `readonly id: SessionId`; `readonly cwd?: string` (**optional**); `readonly origin?: 'subagent'` (**optional**) |
| `session.append('compaction/prune', …)` | `index.js:872-876` | `dsh-compaction/src/types.ts:82-89` — **not** in `dsh-session`'s core `SessionEventMap` | **CONTRACT, but owned by a *different* package** (`@deepseek-ai/dsh-compaction`) | `dsh-session/lib/types/types.d.ts:261` `SessionEventMap` has no `compaction/prune`; the type lives in `dsh-compaction/src/types.ts` and merges into the map via "plugin-merged extensions included" (`types.d.ts:442`) |
| `ctx.systemPrompt.section(section)` | `index.js:663` | `dsh-system-prompt/lib/types/index.d.ts:256` | **CONTRACT** (typed) | `section(section: PromptSection): () => void` |
| `ctx.systemPrompt.context(context)` | `index.js:726` | `dsh-system-prompt/lib/types/index.d.ts:275` | **CONTRACT** (typed) | `context(context: PromptContext): () => void` |
| `ctx.tools.restrict(filter)` | `index.js:739` | `dsh-tools/lib/types/index.d.ts:58` | **CONTRACT** (typed) | `restrict(filter: ToolRestriction): () => void` — "the exact disposer that lifts this restriction" |
| `ctx.tools.definitions(scope?, toolSet?)` | `index.js:719` | `dsh-tools/lib/types/index.d.ts:102` | **CONTRACT** (typed) | `definitions(scope?: ScopeKey, toolSet?: ResolvedToolSet): readonly ToolDefinition[]` |
| `ctx.tokenMeter.estimateMessage(message)` | `index.js:823-824`, `866` | `dsh-token-meter/lib/types/index.d.ts:64` | **CONTRACT** (typed) | `estimateMessage(message: Message): number` |
| `ctx.tokenMeter` projections `tokenUsage` / `contextPressure` / `contextBreakdown` | `index.js:480-482` | `dsh-token-meter/lib/types/projection.d.ts:67,69,71` | **CONTRACT, but *excluded from session.list summaries*** | `contextPressure: SessionProjectionSummaryExcluded<ContextPressureProjection>`; `contextBreakdown: SessionProjectionSummaryExcluded<ContextBreakdownProjection>` — the `SessionProjectionSummaryExcluded` wrapper marks them as not carried in `session.list` summaries |
| `ctx.sessionQuery.searchSessions(request, exec?)` | `index.js:988`, `1003` | `dsh-session-query/lib/types/index.d.ts:63` | **CONTRACT** (typed) | `abstract searchSessions(request: SessionSearchRequest, exec?: SessionSearchExecContext): Promise<SessionSearchPage<SessionSearchHit>>` |
| `ctx.sessionProjections.snapshot(session, keys)` | `index.js:473`, `479` | `dsh-session-projection` (2 `.d.ts`) | **CONTRACT** — but the *cached* read is **DEP** | `<dsh>/docs/upgrade-guide/v0.2.2-alpha.2/projection-snapshot-scope/guide.md:12`: "The registry's `cachedSnapshot(session, keys)` is deprecated" (the plugin uses `snapshot`, not `cachedSnapshot`) |
| `ctx.connection` (optional, via `ctx.inject(['connection'], …)`) | `index.js:504` | `<dsh>/docs/capability-seams.md:668` (`ctx.connection`, role `core`) | **DOC** (no published type located) | plugin treats it as *optional*: `try { ctx.inject(['connection'], mountDevStats) } catch { mountDevStats() }` |
| `ctx.settings` / `settings.section` slot | `client.js:642` (`ctx.slots.inject('settings.section', …)`) | `<dsh>/docs/capability-seams.md:704` (`ctx.settings`, role `core`) | **DOC** — slot name is a string literal | `ctx.slots.inject('settings.section', …)` is a string-keyed slot registration |
| `agent.inject(message)` / `agent.cancel(cause, opts)` | `index.js:1030`, `1130`, `1223`, `1388`; `1135`, `1181` | `dsh-agent/lib/types/index.d.ts` (Agent type) | **CONTRACT** (typed) — `agent.inject` is documented in `dsh-session/lib/types/types.d.ts:300` ("a synthetic `agent.inject()` context") | `agent.cancel({ kind: 'hook', reason: … }, { keepInbox: true })` — the `kind`/`reason`/`keepInbox` shape is not declared in a published `.d.ts` located here → **UNVERIFIABLE** |
| `ctx.get(name, strict?)` | `index.js:470`, `473`, `985`, `988`; `devstats-server.js:261` | `<dsh>/docs/cordis-api/context.md:237-257` (Cordis vendor contract) | **CONTRACT** (Cordis) | "Read a service from the store without the inject requirement. … **Returns** the service value, or `undefined` when not (yet) provided." |
| `ctx.inject(deps, callback)` | `index.js:502-504` | `<dsh>/docs/cordis-api/registry.md:8-33` | **CONTRACT** (Cordis) | "Run a callback once the requested services are available. … the callback is unloaded and re-run whenever a required service changes." |
| Plugin `export const inject = ['tools','systemPrompt','tokenMeter']` | `index.js:83` | Cordis plugin shape; `<dsh>/docs/capability-seams.md:722-723` (`ctx.systemPrompt` core, `ctx.tools` core), `:684` (`ctx.tokenMeter` core) | **CONTRACT** (service names are string keys of the `Context` interface, typed by each owning package's `declare module '@deepseek-ai/cordis'`) | each owner package augments the Cordis `Context` interface — e.g. `dsh-system-prompt/lib/types/index.d.ts`: `declare module '@deepseek-ai/cordis' { interface Context { systemPrompt: SystemPrompt } }` |

**Which seams the plugin relies on that are typed:** `agent/created`, `agent/disposed`, `agent/request` (typed but **deprecated**), `tools/post-execute`, `tools/result`, `session.append` + `surfaceOp`, `Session.header`/`.surface`/`.eventAt`/`.snapshotEvents`/`.deriveEventMessage`, `systemPrompt.section`/`.context`, `tools.restrict`/`.definitions`, `tokenMeter.estimateMessage`, `sessionQuery.searchSessions`, `sessionProjections.snapshot`.

**Which the plugin relies on that are NOT typed contracts:** `compaction/prune` payload ownership (`index.js:872` — declared in `@deepseek-ai/dsh-compaction`, merged into `SessionEventMap` from a *different* package), `agent.cancel` argument shape (`index.js:1135`), `ctx.slots.inject('settings.section')` (`client.js:642`), `ctx.connection` (`index.js:504`), and the `ctx.get`/`ctx.inject` calls (Cordis vendor contracts documented in `<dsh>/docs/cordis-api/`, but not in a `@deepseek-ai/dsh-*` published `.d.ts`).

#### C.2 Capability-seam discovery mechanism (verbatim)

DSH offers **three** distinct mechanisms. Quoted from the installed docs.

**(1) `ctx.get(name, strict?)` — optional service lookup, returns `undefined` when absent.**
`<dsh>/docs/cordis-api/context.md:237-257`:

> ### ctx.get(name, strict?)
> ```ts
> /**
>  * Read a service from the store without the inject requirement.
>  *
>  * @param name — the service name.
>  * @param strict — when `true` (default), only return implementations
>  * whose providing fiber is currently active.
>  * @returns the service value, or `undefined` when not (yet) provided.
>  */
> get<K extends string & keyof this>(name: K, strict?: boolean): undefined | this[K]
> get(name: string, strict?: boolean): any
> ```
> Read a service from the store without the inject requirement.
> …
> **Returns** the service value, or `undefined` when not (yet) provided.

**(2) `ctx.inject(deps, callback)` — deferred load; the callback is unloaded and re-run whenever a required service changes.**
`<dsh>/docs/cordis-api/registry.md:8-33`:

> ### ctx.inject(deps, callback)
> ```ts
> /**
>  * Run a callback once the requested services are available.
>  *
>  * Shorthand for `ctx.plugin({ inject, apply: callback })`: the callback
>  * is unloaded and re-run whenever a required service changes.
>  * …
>  * @returns the fiber; awaiting it settles once loading finished.
>  */
> inject(deps: Inject, callback: Plugin.Function<void>): Fiber & PromiseLike<Fiber>
> ```

**(3) Static seam catalog (discovery by *reading*, not by probing).**
`<dsh>/docs/capability-seams.md:4-6` defines the roles and `:655-766` publishes a table with columns `ctx key | Role | Owner | Implementations | Direct consumers | Companion plugins | Note`. Roles are `core`, `seam`, `service`, `bundle`. There is **no runtime feature-probe API** documented in this file — no `ctx.has()`, no `capabilities()` listing, no `probe` for core services. (The only `*Probe*` name in the catalog is `ctx.pluginRegistryProbe` (`capability-seams.md:664`), a **plugin-manager** service for racing registry responses — not a general capability probe.)

**Which mechanism does the plugin use, and which does it bypass?**

| Mechanism | Plugin uses it? | Evidence | Note |
|---|---|---|---|
| `ctx.get(name)` optional lookup | **YES** — for `sessionProjections` and `sessionQuery` only | `index.js:470` `if (typeof ctx.get !== 'function') return null`; `:473` `ctx.get('sessionProjections')`; `:985` `if (typeof ctx.get !== 'function') return`; `:988` `service = ctx.get('sessionQuery')`; `devstats-server.js:261` `return ctx.get(name)` | Both call sites wrap `ctx.get` in `try/catch` and check for `undefined` — correct usage. |
| `ctx.inject(deps, cb)` deferred load | **YES** — for the optional `connection` seam only | `index.js:502-510`: `if (typeof ctx.inject === 'function') { try { ctx.inject(['connection'], mountDevStats) } catch { mountDevStats() } } else { mountDevStats() }` | Falls back to a scope-less mount when `connection` is absent — a deliberate fail-open. |
| Static `ctx.*` service via `inject` array | **YES — as hard requirement** | `index.js:83` `export const inject = ['tools', 'systemPrompt', 'tokenMeter']` | This is the *opposite* of a probe: it is a **hard** declaration. The plugin will not mount at all unless all three exist. It is also the *only* way the plugin gets `ctx.tools` / `ctx.systemPrompt` / `ctx.tokenMeter` — `ctx.get` is never used for them. |
| Capability **probe** before use (feature detection) | **NO — bypassed** | No `ctx.get('tools')` / `ctx.get('systemPrompt')` / `ctx.get('tokenMeter')` anywhere (`grep -n "ctx\.get("` returns only `sessionProjections`, `sessionQuery`) | The plugin trades the probe for the `inject` array, which fails **loudly** (the plugin never loads) rather than silently. |

**BYPASSED (the important one):** the plugin does **not** probe the seams it depends on most — `ctx.tools`, `ctx.systemPrompt`, `ctx.tokenMeter` — and it does **not** probe whether `ctx.systemPrompt.section` / `ctx.tools.restrict` / `ctx.tokenMeter.estimateMessage` still exist on the returned service objects. It probes only two *optional* services it added later (`sessionProjections`, `sessionQuery`) and the optional `connection` seam.

#### C.3 Manifest / version assertion surface — what is *enforced* vs merely *read*

**Declarative surface the plugin already uses** (`<plugin>/package.json`):

| Field | Plugin value | Line | Loader behavior | Evidence |
|---|---|---|---|---|
| `engines.dsh` | `">=0.2.2-alpha.2 <0.3.0"` | `:61` | **ENFORCED — pre-mount, before plugin code is imported** | `<dsh>/node_modules/@deepseek-ai/dsh-app-boot/lib/index.js:1099-1108`: `function satisfies(runtimeVersion, range) { return range.trim() !== "" && semver.satisfies(runtimeVersion, range, { includePrerelease: true }) }`; `:1104-1107`: `if (Object.hasOwn(engines, "dsh")) { … return satisfies(runtimeVersion, range) ? {} : { "engines.dsh": range } }` |
| `engines.node` | `">=24.9"` | `:60` | not evaluated by the DSH loader code located (the loader code path found handles `engines.dsh` + DSH peer deps only) | same file `:1102-1121` |
| `dsh.manifestVersion` | `1` | `:46` | **READ, not enforced at the located code site** | `grep -rn "manifestVersion" <dsh>` (excluding `node_modules`) returned **zero** hits; the only `manifestVersion` occurrences in the whole install are in `@deepseek-ai/dsh-package-manifest/{src/types.ts,lib/types/types.d.ts,README.md}` — i.e. the **type declaration**, not a validator. The declared format is documented as: "`dsh.manifestVersion` | Manifest format identifier; the declared format is `1`, independent of the npm package version and Session format version." (`dsh-package-manifest/README.md`) |
| `dsh.bundle.patch` | `"./cordis.patch.yml"` | `:47-49` | **ENFORCED — the row is applied at composition** | `<dsh>/docs/capability-seams.md` and `dsh-package-manifest/README.md`: "`DshBundleManifest.patch` is one patch file path or an ordered list of them, each relative to the package root; the launcher applies a list in order as one bundle layer." The plugin's own `cordis.patch.yml:1-8` states the row id MUST equal the plugin `name` exported by `lib/index.js` — and `index.js:80` exports `name = 'dsh-tokeneconomizer'` while `cordis.patch.yml:10-11` declares `id: tokeneconomizer-dsh`, `name: '@nolit/dsh-tokeneconomizer'`. |
| `dsh.bundle.platforms` | absent | — | optional; "omission allows every operating system" (`dsh-package-manifest/README.md`) | — |
| `dsh.client` | `{ platform: 'web', immediately: true, inject: ['@deepseek-ai/dsh-client-ui-settings', '@deepseek-ai/dsh-client-locale'] }` | `:50-57` | **ENFORCED on the Client side** (the client module graph is composed from it; `<dsh>/docs/capability-seams.md:760` `ctx.clientModules`: "Composes the `__DSH_BOOT__` entry graph from an incremental dsh.client scan") | `client.js:642` consumes `ctx.slots.inject('settings.section', …)`, i.e. it depends on `@deepseek-ai/dsh-client-ui-settings` actually being present |
| typert registry (`ctx.typert`) | **not used by the plugin** | — | `ctx.typert` is `core` (`capability-seams.md:699`) — "Plugins register live zod contributions directly or through dsh-typert-loader" | the plugin registers **no** typert contribution |
| config schema version | **none declared** | — | the plugin's config is a **plain Cordis patch row** (`cordis.patch.yml:12-91`), not a schemastery schema; `resolveConfig` at `index.js:258` merges defaults with the raw object | no `Schema.`/`schemastery` schema object is exported by the plugin |

**Enforcement outcome — loud or silent?**

`evaluatePluginCompatibility` (`dsh-app-boot/lib/index.js:1134-1149`) returns `undefined` when every requirement is met; otherwise it returns `{ name, version, runtimeVersion, requirements, exempted }` and the caller renders `pluginCompatibilityWarning` (`:1156-1159`):

> "Plugin ${key} is incompatible with dsh ${issue.runtimeVersion}: requirements ${JSON.stringify(issue.requirements)}. Running it may cause crashes or data loss. Update the plugin or install a plugin version compatible with this dsh runtime. To accept this risk explicitly, grant the exact-version exemption for ${key} on dsh ${issue.runtimeVersion} with `dsh plugin allow-version` or the plugin manager, then retry the installation or restart dsh."

Measured behavior of the plugin's own range against the installed runtime:

- runtime `0.2.2-rc.3`, range `">=0.2.2-alpha.2 <0.3.0"` → `semver.satisfies('0.2.2-rc.3', '>=0.2.2-alpha.2 <0.3.0', { includePrerelease: true })` → **satisfied** (the range's lower bound `0.2.2-alpha.2` is a prerelease and `includePrerelease: true` is set, and `0.2.2-rc.3 < 0.3.0`).
- The range is therefore **currently green**, and it is a **hard, pre-import gate**: the plugin code is never evaluated when the range is unmet ("Evaluate plugin dsh requirements (`engines.dsh`, else dsh peers) **without importing plugin code**" — `dsh-app-boot/lib/index.js:1075`).
- **Exemptions can bypass it.** `exempted` is true when the exact `name@version` pair has an exemption for the exact runtime version (`:1147`); the plugin manager exposes that grant (`dsh-plugin-manager/lib/typert.host.js:216`: "Present when the version's `engines.dsh` or DSH peers reject the running DSH version without an exemption for the exact pair.").
- **Peer-dependency fallback is bypassed by the plugin's own range.** Per `:1123-1128`: "An own `engines.dsh` range decides alone and peerDependencies are ignored." The plugin declares `engines.dsh`, so its (absent) DSH peer deps are never evaluated.

**Verdict for C.3.** The only *hard* version assertion the plugin has is `engines.dsh`, and it is a **pre-import gate with an exact-version exemption escape hatch**. It proves the runtime is within a *range*, but it proves **nothing about individual seam shapes** — the range `>=0.2.2-alpha.2 <0.3.0` spans every 0.2.x patch, and DSH's own upgrade guide documents in-range breaking changes (see C.6). `dsh.manifestVersion` is **read** but **not enforced** at any located code site, so it is a *declaration of intent*, not a contract check. There is **no** config-schema-version field, **no** typert-registry contract, and **no** per-seam version assertion available.

#### C.4 Degradation mechanisms available in DSH (and which the plugin uses)

| # | Mechanism | Where it exists | Plugin uses it? | Evidence |
|---|---|---|---|---|
| D1 | **Hard `inject` array** — plugin does not mount until the named services exist | Cordis plugin shape; plugin's own `index.js:83` | **YES** (for `tools`, `systemPrompt`, `tokenMeter`) | `export const inject = ['tools', 'systemPrompt', 'tokenMeter']` |
| D2 | **`ctx.get(name)` → `undefined` when absent** | `<dsh>/docs/cordis-api/context.md:237-257` | **YES** (for `sessionProjections`, `sessionQuery`) | `index.js:470,473`, `index.js:985,988`, `devstats-server.js:261` |
| D3 | **`ctx.inject(deps, cb)` deferred load + re-run on service change** | `<dsh>/docs/cordis-api/registry.md:8-33` | **YES** (for the optional `connection` seam) | `index.js:502-510` |
| D4 | **Optional-service `try/catch` fail-open** | plugin-local | **YES**, extensively | `index.js:474-476`, `486-488`, `989-991`, `1008-1012`; `catch { mountDevStats() }` at `:505-507`; tiering fail-open notice at `:693-695`; `catch { transcript = '' }` at `:1311-1315` |
| D5 | **Per-feature config flags (feature toggles)** | plugin's own `cordis.patch.yml` | **YES** — ~20 flags | `microskills`, `toolprune`, `loopguard`, `dedup`, `subagentMemory`, `loopBreaker`, `watchdog` (+`watchdogAction`), `tiering` (+tier bounds), `thinkInCode`, `recallPriorSessions`, `exportSessions`, `mode: 'apply'\|'observe'`, `headless: 'auto'` (`cordis.patch.yml:20-91`) |
| D6 | **`mode: 'observe'` — measure but do not mutate** | `cordis.patch.yml:84-88`; `index.js:440` `const applying = () => config.mode !== 'observe'` | **YES** — the plugin's own global fail-safe | `index.js:440`, and the comment at `cordis.patch.yml:84-87`: "`observe` records the same evidence … but injects nothing: no pinned rules, no recall, no pointer substitution, no loop-guard redirect, no surface rewrite." |
| D7 | **`isInert()` — plugin-wide no-op** | `index.js:416`, `772`, `1199` (defined in `prefix.js`, imported at `index.js:55`) | **YES** | `if (isInert()) return` at `index.js:416` (before any config read) |
| D8 | **Per-agent `state.engineEnabled` / `state.closed` / `state.started` gates** | `index.js:552-560`, `776`, `792-793`, `819`, `1028` | **YES** | e.g. `if (!state.engineEnabled || !state.started) return` |
| D9 | **Disabled composition rows / optional plugin rows** | DSH bundle rows; e.g. `fs-observation-policy` "ships disabled" (`<dsh>/docs/upgrade-guide/v0.2.2-alpha.2/fs-observation-policy-default-off/guide.md`) | plugin's own row is `cordis.patch.yml:9` `insert:` with per-feature booleans | the plugin never mounts a *disabled* row itself |
| D10 | **Deprecation warnings surfaced by the compiler** (`no-deprecated` findings) | `<dsh>/docs/upgrade-guide/v0.2.2-alpha.2/projection-snapshot-scope/guide.md:19`: "confirm that type checks pass without `no-deprecated` findings" | **NOT USED** — the plugin is plain JavaScript with no typecheck step | `<plugin>/package.json:63-70` scripts: `test` (node --test), `check` (node --check only — **syntax only, no typecheck**) |
| D11 | **Version exemption** (`dsh plugin allow-version`) | `dsh-app-boot/lib/index.js:1147`, `1158` | not used by the plugin | — |

**Net:** DSH offers **D1 (hard inject)**, **D2 (`ctx.get` → undefined)**, **D3 (`ctx.inject` deferred)** as the *structural* capability-discovery mechanisms. Everything else the plugin uses (D4–D9) is plugin-local. The plugin's degradation discipline is **good for the seams it added late** (`ctx.get` + `try/catch` + `undefined` check on `sessionProjections`/`sessionQuery`) and **absent for the seams it depends on structurally** (`ctx.tools`, `ctx.systemPrompt`, `ctx.tokenMeter` — used bare at `index.js:719`, `663`, `726`, `739`, `823`).


## 4. Plugin implementation contract

The plugin's own contract with the DSH surface, as measured. This section states what the plugin
does today against the schema described in §3 — it is the "plugin assumes" side of the register in §5.

### 4.1 The engine repo key (repokey.js)

#### A.5 The plugin's engine key (repokey.js)

**Path:** `dsh-tokeneconomizer/lib/repokey.js` (238 lines, read in full).

**The rule it implements** (its own header, `repokey.js:1-12`, verbatim):

```js
/**
 * Repository identity, computed the way the engine computes it.
 *
 * The engine keys its per-repository state as `repos/<slug>-<sha1(canon)[:10]>/<host>`, where
 * `canon` is the normalized `origin` remote when the checkout has one, else the real path of the
 * checkout's *main* clone (a linked worktree shares it), else the directory itself. This module
 * reproduces that rule exactly, so a DSH session's `cwd` maps to the same key without a second
 * store and without reading the engine's `repo.json` (which records no path).
 */
```

**The key shape** — `repokey.js:211-217` / `repokey.js:221-227`:

```js
      key: `${slug(name)}-${digest(remote)}`,     // BY_REMOTE
      …
      key: `${slug(name)}-${digest(realOrLexical(main))}`,  // BY_PATH / BY_DIR
```

- `slug(text)` — `repokey.js:32-39`: `toLowerCase()` → `[^a-z0-9]+` → `-` → strip leading/trailing
  `-` → **`.slice(0, 40)`** → fallback `'repo'`.
- `digest(canon)` — `repokey.js:46-48`: `createHash('sha1').update(String(canon),'utf8').digest('hex').slice(0,10)`
  → **first 10 hex chars of SHA-1**.
- `normalizeRemote(url)` — `repokey.js:186-193`: strip `scheme://`, strip `user@`, `host:path` →
  `host/path` (only when the colon is not followed by a digit, i.e. **not** a Windows drive),
  strip trailing `.git`, strip trailing `/`, **`.toLowerCase()`**.
- `repoIdentity(cwd)` — `repokey.js:204-228` — precedence:
  1. `findRepoRoot(cwd)` — walk up from `resolve(cwd)` looking for a `.git` **dir or file**
     (`repokey.js:87-104`), honouring `GIT_CEILING_DIRECTORIES` and treating `$HOME` as a ceiling.
     If found: `normalizeRemote(originUrl(root))`; if non-empty → **BY_REMOTE**:
     `key = slug(lastPathSegment(remote)) + '-' + sha1(remote)[:10]`.
  2. Else if a checkout was found but has **no remote**: `mainCheckout(root)` (resolves `.git` →
     `commondir` → main clone dir, `repokey.js:111-147`) → **BY_PATH**:
     `key = slug(basename(main)) + '-' + sha1(realpath(main))[:10]`.
  3. Else (not a checkout at all): **BY_DIR**: `key = slug(basename(dir)) + '-' + sha1(resolve(dir))[:10]`.

**What exactly is hashed:** the *canon string* — the normalized remote URL (BY_REMOTE), or the
**realpath** of the main checkout (BY_PATH), or the resolved directory (BY_DIR). The **readable
half** is the slug of the repo name (remote's last segment, or the directory basename) — **truncated
to 40 chars**.

**The plugin's own use of it** — `dsh-tokeneconomizer/lib/index.js:997` computes
`key = repoKeyFor(state.cwd)` and then filters `sessionQuery` hits by
`cwd === state.cwd || repoKeyFor(hit.header.cwd) === key` (`:1013-1023`).
**INFERRED:** this is the *only* place the plugin uses the key as a scoping predicate; the durable
ledger/devstats/tool-evidence state is written through the engine's `bin/` hooks with `cwd:
state.cwd` (`lib/index.js:744`, `:779`, `:796`, `:1205`, `:1318`), not with the repo key — see
A.6(d).


### 4.2 Drift-defense constraints already stated upstream

#### C.7 Drift-defense constraints (rationale-bearing, not final design)

These are **constraints** Stage 2 must satisfy. They are derived from the evidence above; none of them is an architecture proposal.

**C7.1 — Every external surface the plugin touches must be classified once, in one place, with an explicit stability tier.**
Rationale: the plugin's surface is currently spread across at least **six** files and ~40 call sites (`index.js` 1396 lines, `bridge.js`, `client.js`, `settings.js`, `prefix.js`, `tiering.js`, `watchdog.js`, `devstats.js`, `devstats-server.js`, `repokey.js`, `dedup.js`, `interrupt-bridge.js`). The seam inventory in C.1 shows the plugin mixes **CONTRACT** seams (`systemPrompt.section`, `tools.restrict`, `sessionQuery.searchSessions`) with **non-contract** ones (`compaction/prune` owned by another package, `settings.section` slot string, `agent.cancel` argument shape) **without any marker distinguishing them in the code**. A single classification module is the only way a future drift audit can be mechanical rather than a re-read of 1396 lines. Constraint: *the classification must record, per surface: the owning package, the published `.d.ts` path if any, the tier from C.1, and the failure mode (loud/silent) from C.5.*

**C7.2 — Capability probes must precede every use of an optional or moving surface; hard `inject` is only for surfaces that are genuinely required for the plugin to exist.**
Rationale: DSH gives exactly two runtime discovery mechanisms (`ctx.get` → `undefined`, `ctx.inject(deps, cb)`), and the plugin already uses both — but **only for surfaces it added late** (`index.js:470-476`, `985-992`, `502-507`). The three surfaces it declared as hard `inject` (`index.js:83`: `tools`, `systemPrompt`, `tokenMeter`) are the ones it uses **bare** at `index.js:719`, `663`, `726`, `739`, `823`. Constraint: *the plugin must not call a service method without first establishing that the method exists (a `typeof` probe or a version gate), and the choice between "hard inject" and "optional probe" must be recorded per surface, not left implicit in the `inject` array.*

**C7.3 — A per-seam failure policy must be declared and enforced: loud-fail vs fail-open, decided per surface, with a visible signal on fail-open.**
Rationale: the evidence shows **both** halves of the failure are unacceptable in their current form. (a) *Fail-open without a signal* — `index.js:824` `if (!meter?.estimateMessage) return` silently disables tiering with **no notice**; `index.js:474-476` and `486-488` silently drop the projection read. (b) *Fail-loud with an unclear scope* — `index.js:871-884` catches an append rejection and continues, so the caller cannot tell whether the tiering worked. Constraint: *every optional surface must have a declared policy, and a fail-open must emit exactly one observable notice per session (not per node), so a silent degradation is distinguishable from a normal run.*

**C7.4 — The version gate must be able to gate on *surface shape*, not only on the DSH version range.**
Rationale: `engines.dsh` is the plugin's **only** hard assertion (`package.json:61`), it is a **pre-import** gate (`dsh-app-boot/lib/index.js:1075`), and it can be **bypassed by an exact-version exemption** (`:1147`, `:1158`). A range cannot express "0.2.2-rc.1 works, 0.2.2-rc.3 does not" for a *single* seam. Constraint: *the plugin must be able to detect, at mount time, which variant of each moving surface the running runtime offers, and degrade deliberately per surface when the variant is not the expected one.* Note this must **not** attempt to detect the DSH version by parsing `process.env` or reading files — the runtime version is not exposed to a plugin as a service in any way I could locate (UNVERIFIABLE — see C.9).

**C7.5 — The deprecated upstream surface must be replaced with a supported one, or the plugin must carry an explicit "runs on a deprecated seam" liability.**
Rationale: `agent/request` is deprecated upstream *today* (`docs/upgrade-guide/v0.2.1-alpha.4/session-model-selection/guide.md:16`, `docs/architecture.md:114`) and the plugin depends on it as the **sole** trigger for its headline token-saving feature (tiering — `index.js:686-698` → `applyTiering` at `:818`). DSH's compatibility contract is "keep it working, warn once" — which means **no failure will be raised when it is removed**; the removal will be silent. Constraint: *the plugin must not have its primary value delivered by a deprecated seam without an explicit, tracked liability and a stated replacement path.* (This constraint is deliberately **not** a design proposal — Stage 2 chooses the replacement.)

**C7.6 — The cross-package surface (`compaction/prune`) must be treated as a versioned dependency, not as a core vocabulary.**
Rationale: `compaction/prune` is **not** in `dsh-session`'s `SessionEventMap` (`dsh-session/lib/types/types.d.ts:261`); it is declared in `@deepseek-ai/dsh-compaction` (`dsh-compaction/src/types.ts:82-89`) and merged in via the plugin-extension mechanism ("plugin-merged extensions included", `types.d.ts:442`). The owning contract adds an ordering MUST: "The replacement MUST be appended synchronously right after this event" (`dsh-compaction/src/types.ts:80`). Constraint: *if the plugin uses a session event type owned by another package, the plugin must (a) know which package owns it, (b) know whether that package is composed in the running profile, and (c) not assume the ordering MUST is still the same.* The plugin **currently does not inject or check `@deepseek-ai/dsh-compaction`** — `package.json` declares no dependency on it.

**C7.7 — The session-export format must be version-stamped on the plugin side, because the upstream format is migrating.**
Rationale: `index.js:1284-1287` writes `{ header: session.header, events: session.snapshotEvents() }` and `bridge.js:219` names the file `${session.header.id}.jsonl` — a byte-level copy of DSH's session-log format. DSH already ships three format migrations (`dsh-session-format-v0-to-v1`, `v1-to-v2`, `v2-to-v3`) and `capability-seams.md:702` states the JSONL backend "persists the SessionEvent vocabulary as one artifact per Session". A migration changes what the Python engine reads, with **no error on the Node side**. Constraint: *the export must carry enough information for the consumer to detect a format change (a version stamp, or a validated envelope), and the plugin must not rely on `header.id` being present.*

**C7.8 — Drift detection must be continuous, because the plugin cannot use the compiler channel.**
Rationale: DSH's documented detection channel for deprecations is the TypeScript compiler — "confirm that type checks pass **without `no-deprecated` findings**" (`docs/upgrade-guide/v0.2.2-alpha.2/projection-snapshot-scope/guide.md:19`). The plugin is plain JavaScript (`"type": "module"`, no `types` field, `package.json:15`) and its only check script is `node --check` (syntax only, `package.json:65`). Constraint: *the plugin needs a substitute detector — a contract-conformance test that asserts each classified surface still has the expected shape (event names present, service methods present, payload keys present) — because nothing else will tell it that upstream moved.*

**C7.9 — Every upstream deprecation channel must be watched, and the plugin's own `engines.dsh` range must be re-tightened against the installed guide.**
Rationale: the installed upgrade guide is regenerated **at pack time** (`docs/upgrade-guide/README.md:3`), so it is a *release-time* artifact, not a live feed; the newest section installed is `v0.2.2-rc.1` while the runtime is `0.2.2-rc.3`. Constraint: *the plugin's compatibility watch must read the upgrade guide of the DSH version it actually runs against, and the `engines.dsh` range should be narrowed to the range the plugin has actually been verified against — a wide range (`<0.3.0`) makes the loader's gate look like a guarantee while the upgrade guide proves in-range breaking changes are routine.*


### 4.3 Overall plugin assumption

**Overall, the plugin assumes that the DSH 0.2.2 session surface is frozen.**

Every one of the 42 gaps in §5 is an instance of that single assumption: the plugin reads DSH
types, event names, payload keys and service methods as if they were constants, and it does so
from plain JavaScript with no typecheck channel (`G-C-02`) and no version gate that can detect a
shape change rather than a version number (`G-C-08`, `G-C-09`). The plugin does have a real
degradation discipline on the seams it added late — `ctx.get` + `try/catch` + `undefined` checks on
`sessionProjections` / `sessionQuery` (`lib/index.js:470-476`, `:985-992`) — and that discipline is
the positive control to imitate. But the seams it depends on *structurally* — `ctx.tools`,
`ctx.systemPrompt`, `ctx.tokenMeter` — are used bare at `lib/index.js:719`, `:663`, `:726`, `:739`,
`:823` (`G-C-06`), and its headline feature rides on a hook upstream has already deprecated
(`G-C-01`, `G-B-06`). The failure mode throughout is **silent**: the plugin keeps mounting, keeps
reporting turns, and keeps producing statistics while the feature underneath has stopped working
(`G-C-07`).

## 5. GAP REGISTER

42 gaps, mechanically collected from the three fragments and sorted blocker → high → medium → low.
IDs are stable and are the citation key for the whole document: §6 assumptions, §7 constraints and
§8 open questions all reference them. Within one severity the order is dimension, then the order in
which the fragment listed the row.

| ID | Dimension | Gap | DSH contract says | Plugin assumes | Silent-break risk | Severity | Evidence |
|---|---|---|---|---|---|---|---|
| G-A-01 | A — project/workspace isolation | **No project/repository entity exists in DSH's session store.** DSH groups sessions by a derived, lossy, path-derived directory name; it has no repository concept. | Session store project dir = `projectKey(rawCwd)`; lossy by design, truncated at 251 | The plugin partitions state per **git repository** (engine `repos/<key>/`) | The plugin's per-repo partition has **no DSH-side durable anchor**; a plugin restart that recomputes keys must re-derive them by re-running git discovery on every session header, and any mismatch silently creates a new bucket | blocker | DSH: `dsh-session-persistence-jsonl/lib/index.js:871-899`; Plugin: `dsh-tokeneconomizer/lib/repokey.js:204-228` |
| G-B-01 | B — session & subagent schemas | The plugin writes the **identical** `compaction/prune` + `tool/result`-replace event pair as `dsh-compaction-tool-result-pruner`, with no distinguishing field. | `compaction/prune` payload is exactly `{ shadowedRange, shadowedSeqs, shadowedTokenCount }` — no producer/origin discriminator; "The shared shadow-price protocol: a surface `replace` event is priced by the metering event immediately before it" | The plugin's `applyTiering` writes the same three fields with the same single-node replace; it assumes its own prune events can be told apart from the pruner's | Any consumer counting prunes, or attributing saved tokens, by event shape **cannot separate the plugin's tiering from the pruner's pruning** — the two are indistinguishable in the log. This is the measurement bug. | blocker | DSH: `dsh-compaction/lib/types/types.d.ts:80-95`; pruner: `dsh-compaction-tool-result-pruner/lib/index.js:159-177`; plugin: `dsh-tokeneconomizer/lib/index.js:871-880`; real log: `session-c6e16f8d-…` seq 888/889 |
| G-C-01 | C — upstream drift resilience | Plugin's headline token-saving feature rides on a **deprecated** upstream hook | "`agent/request` is deprecated." (`docs/upgrade-guide/v0.2.1-alpha.4/session-model-selection/guide.md:16`); "the deprecated `agent/request` hook adjusts controls without changing the provider, model, or effort selection" (`docs/architecture.md:114`) | `agent/request` keeps firing and remains the only trigger for the tiering surface rewrite | **High** — tiering stops entirely, plugin still mounts and reports turns | blocker | DSH: `<dsh>/docs/upgrade-guide/v0.2.1-alpha.4/session-model-selection/guide.md:16`, `<dsh>/docs/architecture.md:114`. Plugin: `<plugin>/lib/index.js:686-698`, `:692` (sole `applyTiering` call site), `:818` |
| G-A-02 | A — project/workspace isolation | **DSH's project slug is lossy and non-injective; two distinct paths can share one session dir.** | "Separator replacement and truncation are intentionally lossy" | The plugin needs a key that is **1:1 with a project** | `/a/b` and `/a-b` → same `--a-b--`; >251-char paths collide on the prefix. A plugin that reconstructs the project from the slug gets the wrong path back | high | DSH: `dsh-session-persistence-jsonl/lib/index.js:871-899` (comment at :874-876, `replace(/^-+/, "")` at :898, `.slice(0, 251)` at :898); Plugin: `dsh-tokeneconomizer/lib/repokey.js:32-39` (different, non-lossy-by-separator scheme) |
| G-A-03 | A — project/workspace isolation | **The session header `cwd` is raw and non-canonical; the slug is derived from it.** | Header validation is only `isAbsolute` — no realpath | The plugin assumes `cwd` identifies a stable, canonical project | A symlinked or moved cwd yields a *different* slug for the same real project; DSH's own workspace registry separately realpath's it (`realpathNormalize`), so the two DSH views disagree | high | DSH: `dsh-session/lib/types/index.js:45-49` (isAbsolute only), `dsh-session-persistence-jsonl/lib/index.js:880` (projectKey(raw)), vs `dsh-workspace/lib/types/paths.js:43-48` (realpathNormalize); Plugin: `dsh-tokeneconomizer/lib/repokey.js:55-61` (realOrLexical, path-only fallback) |
| G-A-04 | A — project/workspace isolation | **`sessionQuery`'s `cwd` filter is exact-match on the raw header string; there is no subtree/project filter.** | `filter.values.includes(record.header.cwd ?? null)` / SQL `cwd IN (…)` | The plugin needs "all sessions of this project", widening an exact `cwd` match itself | The plugin widens with a **git re-derivation** per hit (`repoKeyFor(hit.cwd)`) — an O(hits) filesystem+git walk per recall, and any repo-detection difference silently drops history | high | DSH: `dsh-session-query/lib/index.js:792`, `dsh-session-query-sqlite/lib/index.js:217-218`; Plugin: `dsh-tokeneconomizer/lib/index.js:1013-1023` |
| G-A-05 | A — project/workspace isolation | **There is no per-project display-name / createdAt / pinned store for unregistered directories.** Only the **Workspace registry** has those, and only for user-registered dirs, keyed by UUID. | Workspace record: `path` (realpath canon), `title`, `sessionIds`, `createdAt`, `updatedAt`; id = `randomUUID()` | The plugin wants per-project identity it can display and partition on | The plugin **cannot** obtain a stable project id for an unregistered directory; the only DSH-owned stable ids are **session ids** and **workspace UUIDs** | high | DSH: `dsh-workspace/lib/index.js:209-215`, `:652`, `:643-645`; Plugin: `dsh-tokeneconomizer/lib/repokey.js:204-228` |
| G-A-11 | A — project/workspace isolation | **Tool-mask / evidence payloads are addressed by exact `cwd`, but the engine's envelope is per repository.** | Plugin sends `cwd: state.cwd` to the engine hook; the engine keys per `repos/<key>/` | The plugin assumes the engine's per-repo state accumulates per repo | Two directories of one repo accumulate **two** independent tool-evidence sets; the deny list applied in `/repo/src` does not apply in `/repo` | high | Plugin: `dsh-tokeneconomizer/lib/index.js:744` (SessionStart payload `cwd`), `:779`, `:796` (UserPromptSubmit / Stop payloads `cwd`), `:1205` (PostToolUse payload `cwd`), `:1318` (SessionEnd payload `cwd`), and the divergence note at `:24-27`; DSH: `dsh-session-persistence-jsonl/lib/index.js:880` (no repo axis at all) |
| G-A-12 | A — project/workspace isolation | **Rename/move of the project directory orphans the DSH project dir while the engine repo key survives.** | Slug is a pure function of the path string | The plugin assumes a project keeps its identity across a move | The engine's ledger and the plugin's engine-key partition follow the repo; the DSH session store does not — so a "prior session" lookup and the ledger disagree about what the project is | high | DSH: `dsh-session-persistence-jsonl/lib/index.js:880-899`; Plugin: `dsh-tokeneconomizer/lib/repokey.js:204-228` (BY_REMOTE is move-invariant) |
| G-A-14 | A — project/workspace isolation | **The engine's own key algorithm is *not* DSH's; the plugin is the only thing that knows it.** | DSH exposes no repo key, no git awareness, no remote awareness | The plugin re-implements an **external** engine's key rule in `repokey.js` | Any change in the engine's canonicalization is invisible to DSH and silently re-partitions the plugin's ledgers. The plugin's own docstring says it reproduces the rule "exactly" — an unverifiable claim against a system DSH does not own | high | Plugin: `dsh-tokeneconomizer/lib/repokey.js:1-12`, `:196-238`; DSH: `dsh-session-persistence-jsonl/lib/index.js:871-899` (no git/remote logic anywhere) |
| G-A-15 | A — project/workspace isolation | **`header.cwd` is a snapshot, not the live working directory; DSH emits `working-directory/change` and the plugin ignores it.** | `ctx.workingDirectory` folds `working-directory/change` into the live cwd (`dsh-working-directory/lib/index.js:56-57`, `:172`); the new cwd is `fs.realpath`-resolved (`dsh-fs-local/lib/index.js:188`) | The plugin caches `state.cwd` once at `lib/index.js:546` and uses it for the repo key, the recall predicate, and every engine payload | After a mid-session `cd`, the plugin's project identity is the **old** directory: the engine key changes, the recall predicate misses, and the evidence payload is attributed to the wrong directory | high | DSH: `dsh-working-directory/lib/index.js:56-57`, `:172`; `dsh-fs-local/lib/index.js:182-189`; Plugin: `dsh-tokeneconomizer/lib/index.js:546` (`const cwd = agent.session.header.cwd ?? process.cwd()`), `grep -n "working-directory" lib/index.js` → 0 hits |
| G-B-02 | B — session & subagent schemas | The plugin classifies "subagent" **only** from `header.origin === 'subagent'`. | `origin` is "Coarse product classification for a session created as a subagent child. **This is presentation metadata, not proof that the child is continuable.**" `parentSession` "Presence alone does not classify a Session as a subagent; use `origin` for that distinction." | `lib/index.js:528` `const isSubagent = agent.session.header.origin === 'subagent'` — treated as ground truth for enabling/disabling the whole memory path (`lib/index.js:544` `if (isSubagent && config.subagentMemory !== true) return`) | If a future DSH introduces a subagent session that omits `origin` (or a non-subagent that sets it), the plugin silently enables the **wrong** path for that child with no error — the entire memory layer is skipped or wrongly applied. | high | DSH: `dsh-session/lib/types/types.d.ts:82-86` and `:71-76`; plugin: `dsh-tokeneconomizer/lib/index.js:528,544`; real headers: `origin:"subagent"` present on children, absent on root (`session-e8e3300f-…` vs `8f53a8b4-…`) |
| G-B-03 | B — session & subagent schemas | The plugin appends to the **model-visible surface** of a live session from inside a `agent/request` waterfall, without any documented permission or lease. | `Session.append` doc: "Once a store prepares or enters the instance, writes require a completed creation announcement and remain disabled after removal." `surfaceOp` is a **core** contract validated by the core fold (`surface.js:299-455`). | `applyTiering(state)` is called from `agent/request` (`lib/index.js:686-698`) and appends `compaction/prune` + `tool/result` (`:872-880`) inside the waterfall, before `next()` | If DSH tightens the append contract (e.g. forbids surface writes during a request waterfall, or forbids `tool/result` appends outside the tool pipeline), the plugin's tiering silently stops working — the try/catch at `:884` swallows the failure as "fail open", so **no error surfaces at all**. | high | DSH: `dsh-session/lib/types/index.d.ts:262-300`; `dsh-session/lib/types/surface.js:299-455`; plugin: `dsh-tokeneconomizer/lib/index.js:686-698, 871-887` (catch-all at `:884`) |
| G-B-04 | B — session & subagent schemas | The plugin uses three **deprecated** Session read APIs whose doc says "new calls are prohibited". | `eventAt` — "@deprecated Existing logic may remain unmigrated for now, but **new calls are prohibited**." `snapshotEvents` — same. `ownEvents` — same. (`dsh-session/lib/types/index.d.ts:214-239`) | `session.eventAt(seq)` at `lib/index.js:837`; `session.snapshotEvents()` at `lib/index.js:748` and `:1286` | A DSH release that removes/changes these breaks tiering (`eventAt`) and the whole session export (`snapshotEvents`) with no type-level warning (plugin is plain JS). | high | DSH: `dsh-session/lib/types/index.d.ts:214-232`; plugin: `dsh-tokeneconomizer/lib/index.js:748,837,1286` |
| G-B-05 | B — session & subagent schemas | The plugin calls the **single-event** `session.append(type, data, opts)` form, which is **not declared** in any `.d.ts`. | `dsh-session/lib/types/index.d.ts:259` declares only `append(inputs: readonly SessionEventInput[]): readonly SessionEvent[]`. The runtime has `append(type, data, ...opts)` (`dsh-session/lib/types/index.js:630-640`). | `session.append('compaction/prune', {...})` and `session.append('tool/result', {...}, { surfaceOp, sourceEventSeqs })` — the undocumented 3-arg form | The declaration and the runtime disagree. If the runtime is regenerated/re-typed to the declared array-only form, the plugin breaks with no compile-time warning (plain JS). Any TS consumer copying the plugin's pattern hits a type error today. | high | DSH: `dsh-session/lib/types/index.d.ts:259` vs `dsh-session/lib/types/index.js:630`; plugin: `dsh-tokeneconomizer/lib/index.js:872,877` |
| G-C-02 | C — upstream drift resilience | The plugin has **no** deprecation-detection channel | The compiler is the documented detector: "confirm that type checks pass without `no-deprecated` findings" (`docs/upgrade-guide/v0.2.2-alpha.2/projection-snapshot-scope/guide.md:19`); `@deprecated` markers live in published `lib/types/*.d.ts` | Plain JavaScript; `scripts.check` is `node --check` (syntax only); no typecheck step exists | **High** — an upstream deprecation reaches the plugin with zero signal | high | DSH: `<dsh>/docs/upgrade-guide/v0.2.2-alpha.2/projection-snapshot-scope/guide.md:19`; `<dsh>/node_modules/@deepseek-ai/dsh-session/lib/types/types.d.ts:552` (a `@deprecated` marker the plugin cannot see). Plugin: `<plugin>/package.json:15` (`"type": "module"`, no `types`), `:65` (`check` script), `:63` (`test` = `node --test test/*.test.mjs`) |
| G-C-03 | C — upstream drift resilience | Plugin uses a session event type owned by a **different package** it does not depend on | `compaction/prune` is declared in `@deepseek-ai/dsh-compaction` (`dsh-compaction/src/types.ts:82-89`), **not** in the core `SessionEventMap` (`dsh-session/lib/types/types.d.ts:261`); "plugin-merged extensions included" (`types.d.ts:442`); "The replacement MUST be appended synchronously right after this event" (`dsh-compaction/src/types.ts:80`) | `session.append('compaction/prune', …)` always works | **High** — append throws; the plugin's `try/catch` skips the rewrite for that node with no notice | high | DSH: `<dsh>/node_modules/@deepseek-ai/dsh-compaction/src/types.ts:82-89`; `<dsh>/node_modules/@deepseek-ai/dsh-session/lib/types/types.d.ts:261,442`. Plugin: `<plugin>/lib/index.js:872-876`, `:884` (catch), `<plugin>/package.json` (no `@deepseek-ai/dsh-compaction` dependency) |
| G-C-04 | C — upstream drift resilience | `Session.append` **overload shape** is in flux and the plugin calls the single-event form | "Code that replaces Session.append must implement both the single-event and array overloads." (`docs/upgrade-guide/v0.2.2-rc.1/session-append-overloads/guide.md`); `append(inputs: readonly SessionEventInput[]): readonly SessionEvent[]` (`dsh-session/lib/types/index.d.ts:259`); `surfaceOp` is REQUIRED for surface events and "rejected by the compiler for non-surface types" (`index.d.ts:273-283`, `types.d.ts:521`) | `session.append(type, data, opts)` with `{ surfaceOp: { op: 'replace', startSeq, endSeq }, sourceEventSeqs }` keeps working verbatim | **Medium** — the append throws and the tiered replacement is silently skipped | high | DSH: `<dsh>/docs/upgrade-guide/v0.2.2-rc.1/session-append-overloads/guide.md`; `<dsh>/node_modules/@deepseek-ai/dsh-session/lib/types/index.d.ts:259,273-283`; `types.d.ts:521`. Plugin: `<plugin>/lib/index.js:877-880` |
| G-C-05 | C — upstream drift resilience | The plugin writes a **byte-level copy of DSH's session format** with no version stamp | "The JSONL backend persists the SessionEvent vocabulary as one artifact per Session." (`docs/capability-seams.md:702`); three format-migration packages ship in the install (`dsh-session-format-v0-to-v1`, `v1-to-v2`, `v2-to-v3`) | `{ header, events }` and `header.id` are stable enough to write `undefined.jsonl` and feed the Python engine | **High** — the export silently becomes unreadable to the engine | high | DSH: `<dsh>/docs/capability-seams.md:702`; `<dsh>/node_modules/@deepseek-ai/dsh-session-format-v0-to-v1/`, `-v1-to-v2/`, `-v2-to-v3/` (package dirs). Plugin: `<plugin>/lib/index.js:1284-1287`, `<plugin>/lib/bridge.js:219` |
| G-C-06 | C — upstream drift resilience | Structural services are used **bare** — no method-existence probe | `ctx.get(name)` "Returns the service value, or `undefined` when not (yet) provided" (`docs/cordis-api/context.md:237-257`); `ctx.inject(deps, cb)` "Run a callback once the requested services are available" (`docs/cordis-api/registry.md:8-33`) | `ctx.systemPrompt.section`, `ctx.systemPrompt.context`, `ctx.tools.restrict`, `ctx.tools.definitions`, `ctx.tokenMeter.estimateMessage` always exist | **High** — a rename throws inside `agent/created`/`start()`, killing the whole per-agent mount | high | DSH: `<dsh>/docs/cordis-api/context.md:237-257`; `<dsh>/node_modules/@deepseek-ai/dsh-system-prompt/lib/types/index.d.ts:256,275`; `dsh-tools/lib/types/index.d.ts:58,102`; `dsh-token-meter/lib/types/index.d.ts:64`. Plugin: `<plugin>/lib/index.js:663`, `:726`, `:739`, `:719`, `:823-824` |
| G-C-10 | C — upstream drift resilience | **Unguarded** `event.data` read in the hot event path | `SessionEventMap` types each payload (`dsh-session/lib/types/types.d.ts:261-400`); `session/event` is typed `(session, event: SessionEvent) => void` (`dsh-session/lib/types/index.d.ts:66`) | `event.data.turn` is always present (`index.js:775`) and `event.data.callId/name/arguments` always present (`index.js:902`, `:908-911`) | **Medium** — a `TypeError` inside the session-event listener, uncaught by the plugin | high | DSH: `<dsh>/node_modules/@deepseek-ai/dsh-session/lib/types/index.d.ts:66`; `types.d.ts:261-400`. Plugin: `<plugin>/lib/index.js:775` (no `?.`), `:902`, `:908-911` — contrasted with the guarded reads at `:785`, `:842`, `:853`, `:861`, `:951` |
| G-A-07 | A — project/workspace isolation | **Workspace registry identity is a UUID and is registry-scoped, not derivable from `cwd` without a lookup.** | `resolveByPath(path)` = realpath + exact string equality; ids minted as `randomUUID()` | The plugin wants a pure function of `cwd` → project key | `resolveByPath` is async, needs the registry service, and returns `undefined` for unregistered dirs — so it cannot be a universal key source | medium | DSH: `dsh-workspace/lib/index.js:643-645`, `:652`; Plugin: `dsh-tokeneconomizer/lib/repokey.js:236-237` (pure sync function) |
| G-A-08 | A — project/workspace isolation | **`ctx.sessionProjections` has no project axis.** | Projections register per key with a `stateVersion`; the unit table has no cwd/workspace parameter | The plugin might scope derived state (ledger, devstats) through a projection | Any project-scoped derived state must be keyed by something the plugin supplies; DSH will not index it by project | medium | DSH: `dsh-session-projection/lib/index.js:129-144`; Plugin: `dsh-tokeneconomizer/lib/devstats.js` (pure fold over events, **0** occurrences of `cwd`), `dsh-tokeneconomizer/lib/devstats-server.js:88-101` (cwd attached only to a per-session summary) |
| G-A-09 | A — project/workspace isolation | **`ctx.jobs`, `ctx.goal`, and the team task board expose no cwd/project scoping key.** | `grep -rn "cwd" dsh-jobs/lib/ dsh-jobs-local/lib/` → **0 hits**; `dsh-goal/lib/` → 0 hits outside the generated `typert.host.js:1139`; team injects `sessions`, not `workspaceRegistry` | The plugin (or a consumer) might expect jobs/goals/tasks to be project-scoped | Any "per-project" view over jobs/goals/tasks must be built by the plugin from session ids | medium | DSH: `dsh-agent-team/lib/types/index.js:67`, `dsh-jobs/lib/`, `dsh-goal/lib/`; Plugin: n/a (plugin has no jobs/goals/tasks surface) |
| G-A-10 | A — project/workspace isolation | **A fourth, incompatible path-canonicalization rule exists in `dsh-sidebar-manager` (lowercased, `path.resolve`, no realpath).** | `normalizePath` = `path.resolve(v).replace(/\\/g,'/').toLowerCase()`; fingerprint compares path **and** title | The plugin assumes path-based identity | Case-folded identity vs DSH's case-sensitive slug: the same directory can be two DSH dirs and one sidebar group | medium | Sidebar: `dsh-sidebar-manager/lib/groups.mjs:75-85`; DSH: `dsh-session-persistence-jsonl/lib/index.js:890` (case preserved) |
| G-A-13 | A — project/workspace isolation | **A Workspace record's `path` is immutable — there is no supported "workspace moved" operation.** | "both inputs (stored header cwd, workspace path) are immutable"; the only mutator is `setTitle` | The plugin may want to follow a project across a move | A moved directory leaves the Workspace record pointing at a dead realpath; the sessions under it fall into `missingSessionPaths` and are dropped from `sessionIds` (`candidateMatches` filter, `dsh-workspace/lib/index.js:103`) | medium | DSH: `dsh-workspace/lib/types/entity.js:57-83` (verbatim comment), `dsh-workspace/lib/index.js:103`, `:105` (only `setTitle`); Plugin: n/a |
| G-B-06 | B — session & subagent schemas | The plugin's tiering trigger is the **`@deprecated`** `agent/request` waterfall. | `agent/request` — "@deprecated Retained for existing listeners; **do not add new listeners.** Use `agent.model.select() before step preparation` …" (`dsh-agent/lib/types/runtime-types.d.ts:352-355`) | `state.agent.ctx.on('agent/request', async (payload, next) => { … applyTiering(state) … return next() })` (`lib/index.js:686-698`) | When `agent/request` is removed, the tiering trigger disappears. The plugin's tiering silently stops applying (no error path — `applyTiering` is inside a try/catch that only catches its own throw). | medium | DSH: `dsh-agent/lib/types/runtime-types.d.ts:341-368` (esp. `:352-355`); plugin: `dsh-tokeneconomizer/lib/index.js:686-698` |
| G-B-07 | B — session & subagent schemas | The plugin's `session/event` handler has **no per-agent identity guard**, unlike its `tools/*` and `agent/request` handlers. | `session/event` is scope-filtered ("agent-scoped listeners receive events from sessions entered through that agent's context", `dsh-session/lib/types/index.d.ts:60-61`) but the payload carries the real `session` argument. | `state.agent.ctx.on('session/event', (session, event) => onEvent(state, session, event))` (`lib/index.js:682`) and `onEvent(state, _session, event)` **discards** the session parameter (`lib/index.js:771`) | If the scope carrier ever delivers a foreign session's events, the plugin attributes them to the wrong agent — wrong turn counter, wrong prompt, wrong dedup/breaker state. Silent mis-attribution, no exception. | medium | DSH: `dsh-session/lib/types/index.d.ts:53-66`; plugin: `dsh-tokeneconomizer/lib/index.js:682, 771` — contrast the guarded handlers at `:675`, `:687`, `:1201` |
| G-B-08 | B — session & subagent schemas | The plugin relies on `session.surface.nodes` being the **current** surface, and assumes every node is a `tool/result` it may replace. | A `replace` target must be a **current** surface node (`replacementRange`, `surface.js:309-327`); a `tool/result` replacement "must rewrite exactly one current node" and "must target a current `tool/result`" (`surface.js:353-360`). | `applyTiering` iterates `for (const seq of [...nodes])` and calls `session.eventAt(seq)` (`lib/index.js:834-841`), wrapping each in try/catch that `continue`s on failure (`lib/index.js:836-840`) | A stale/foreign node or a node already shadowed throws inside `Session.append` → caught by the plugin's `catch {}` at `:884` → "fail open". Tiering silently skips that node. Because the catch is silent, a systematic contract violation degrades **quietly**. | medium | DSH: `dsh-session/lib/types/surface.js:309-327, 349-375`; plugin: `dsh-tokeneconomizer/lib/index.js:832-841, 871-887` |
| G-B-09 | B — session & subagent schemas | The plugin has **no persisted record** of its own tiering — no `plugin:`-namespaced record, no own event type. | `PluginRecordMap` is **empty** in this build (`dsh-session/lib/types/types.d.ts:538-539`); `appendPluginRecord` exists but is restricted ("Only production source under `packages/experimental/` may call this function", `dsh-session/lib/types/index.d.ts:108-111`) | The plugin's tiering is only inferable from the shared `compaction/prune` shape (see G-B-01) — it writes **no** plugin-owned marker | Any future DSH release that distinguishes prune producers, or any consumer trying to attribute savings, has no plugin-owned identity to read. The plugin's effect is permanently indistinguishable from the pruner's. | medium | DSH: `dsh-session/lib/types/types.d.ts:531-555`; `dsh-session/lib/types/index.d.ts:98-124`; plugin: `dsh-tokeneconomizer/lib/index.js:871-880` (no plugin record anywhere in `lib/index.js`) |
| G-B-12 | B — session & subagent schemas | The plugin's `agent/created` handler is `async` and awaits engine startup; a rejection there **fails agent creation**. | `agent/created` — "A throw or rejection **fails creation** and skips later listeners." (`dsh-agent/lib/types/runtime-types.d.ts:245-247`) | `ctx.on('agent/created', async ({ agent, source }) => { … if (state.engineEnabled) await start(state, source) })` (`lib/index.js:527`, `:613`) | If `start()` rejects, the whole agent fails to create — a plugin-caused session failure. Whether `start()` internally catches is implementation-dependent; the `await` at `:613` is unguarded at the call site. | medium | DSH: `dsh-agent/lib/types/runtime-types.d.ts:242-259`; plugin: `dsh-tokeneconomizer/lib/index.js:527-614` (bare `await start(state, source)` at `:613`) |
| G-C-07 | C — upstream drift resilience | Fail-open paths emit **no** notice | DSH's own convention for a degrading seam is a visible warning: `pluginCompatibilityWarning` "Running it may cause crashes or data loss…" (`dsh-app-boot/lib/index.js:1156-1159`); the projection registry uses "once-per-key deprecation warnings" (`docs/subsystems/session-projection.md:38`) | `if (!meter?.estimateMessage) return` (`:824`), `catch { return null }` (`:474-476`, `:486-488`), `catch { return }` (`:989-991`, `:1008-1012`) — silent | **Medium** — a silent degradation is indistinguishable from a normal run | medium | DSH: `<dsh>/node_modules/@deepseek-ai/dsh-app-boot/lib/index.js:1156-1159`; `<dsh>/docs/subsystems/session-projection.md:38`. Plugin: `<plugin>/lib/index.js:824`, `:474-476`, `:486-488`, `:989-991`, `:1008-1012` |
| G-C-08 | C — upstream drift resilience | The plugin's `engines.dsh` range is **wide** and gives a false sense of a guarantee | "`engines.dsh` … Author-declared compatible DSH versions as a SemVer range, including exact prerelease versions." (`dsh-package-manifest/README.md`); the loader evaluates it "**without importing plugin code**" (`dsh-app-boot/lib/index.js:1075`) and can be bypassed by an exact-version exemption (`:1147`, `:1158`) | `">=0.2.2-alpha.2 <0.3.0"` means "compatible with this plugin" | **Medium** — in-range breaking changes (14 documented in the installed guide) pass the gate | medium | DSH: `<dsh>/node_modules/@deepseek-ai/dsh-package-manifest/README.md`; `<dsh>/node_modules/@deepseek-ai/dsh-app-boot/lib/index.js:1075,1147,1158`. Plugin: `<plugin>/package.json:61` |
| G-C-11 | C — upstream drift resilience | `source.kind` **string values** are a plugin↔DSH private vocabulary | `user/message` is "A user-role message on the model-visible surface: a direct human prompt…, a synthetic `agent.inject()` context…, or an entered goal continuation round. All three project their `content` verbatim; `source` tells them apart." (`dsh-session/lib/types/types.d.ts:300-305`) | `'user'` is the only non-plugin human kind (`index.js:785`, `:951`); the plugin's own kind is the **self-defined** `'tokeneconomizer'` (`index.js:329`), which DSH does not define | **Medium** — a new upstream kind makes the plugin treat a non-human message as human (recall budget) or lose its own notices (watchdog never interrupts) | medium | DSH: `<dsh>/node_modules/@deepseek-ai/dsh-session/lib/types/types.d.ts:300-305`. Plugin: `<plugin>/lib/index.js:329`, `:785`, `:951-952`, `:349-355`, `:961-968` |
| G-C-12 | C — upstream drift resilience | `header.origin` has exactly **one** legal value; the plugin branches on it | `readonly origin?: 'subagent'` (`dsh-session/lib/types/types.d.ts:86`); `readonly cwd?: string` (`:70`); "`origin`" is the subagent discriminator (`:74`) | `agent.session.header.origin === 'subagent'` means "root session" otherwise (`index.js:528`) | **Medium** — a second origin kind upstream makes a child run the root-only engine path (double-counted turns, unwanted export) | medium | DSH: `<dsh>/node_modules/@deepseek-ai/dsh-session/lib/types/types.d.ts:70,74,86`. Plugin: `<plugin>/lib/index.js:528`, `:532-540`, `:546` |
| G-C-13 | C — upstream drift resilience | The client-side slot name is an **untyped string literal** | `ctx.settings` is `core` (`docs/capability-seams.md:704`); `ctx.clientModules` "Composes the `__DSH_BOOT__` entry graph from an incremental dsh.client scan" (`:760`) | `ctx.slots.inject('settings.section', …)` resolves | **Medium** — the settings section silently never appears | medium | DSH: `<dsh>/docs/capability-seams.md:704,760`. Plugin: `<plugin>/lib/client.js:642`; `<plugin>/package.json:50-57` |
| G-C-14 | C — upstream drift resilience | The plugin has **no** declared dependency on the packages whose contracts it uses | The seam table names the **owner** package per `ctx` key and separates `core` / `seam` / `service` roles (`docs/capability-seams.md:655-766`); `ctx.sessionQuery` is a `seam` with the `session-query-sqlite` implementation (`:718`) | `ctx.sessionQuery`, `ctx.sessionProjections`, `ctx.connection`, `@deepseek-ai/dsh-compaction`'s `compaction/prune` are all present in the running composition | **Medium** — a composition without them silently loses recall, projections, dev-stats and tiering | medium | DSH: `<dsh>/docs/capability-seams.md:684,718,728,668`. Plugin: `<plugin>/package.json:59-62` (only `engines`), `<plugin>/lib/index.js:473,504,872,988` |
| G-A-06 | A — project/workspace isolation | **DSH's pin/archive state is per-session, not per-project** | `global.pinnedSessionIds`, `global.archivedSessionIds` — registry-global **session id** sets; measured live as `[]` | The plugin may want a "pinned project" or "favorite project" concept | There is **no** DSH concept of a pinned project; a project-level pin would have to be the plugin's own store | low | DSH: `dsh-workspace/lib/index.js:240-248`; measured `/home/minami/.dsh/storages/workspace.json` → `"pinnedSessionIds":[]`, `"archivedSessionIds":[]` |
| G-B-10 | B — session & subagent schemas | The plugin reads `header.cwd` with `?? process.cwd()` as a fallback, but the header's `cwd` is optional and can be absent. | `cwd` — "Absolute working directory the session was created in **(if any)**." (`dsh-session/lib/types/types.d.ts:69-70`); `HeaderLine.cwd?` (`dsh-session-persistence-jsonl/lib/types/format.d.ts:47`) | `const cwd = agent.session.header.cwd ?? process.cwd()` (`lib/index.js:546`) — the fallback is the **plugin process's** cwd, not the session's | A session created without a cwd would have its engine hooks and exports rooted at the harness process cwd rather than the session's project dir. Silent mis-rooting; the fallback is indistinguishable from a real cwd. | low | DSH: `dsh-session/lib/types/types.d.ts:69-70`; `dsh-session-persistence-jsonl/lib/types/format.d.ts:47`; plugin: `dsh-tokeneconomizer/lib/index.js:546` |
| G-B-11 | B — session & subagent schemas | The plugin's engine path is gated on `!isSubagent` and therefore **never runs for a subagent child**; the DSH contract provides no field that says "this child is continuable". | `origin` is "presentation metadata, not proof that the child is continuable"; the real mode lives in the `subagent/descriptor` event (`mode: 'one-shot' \| 'continuable'`), which is **log-only** and appended "inside the child's initial turn, **before its first request**" (`dsh-subagent/lib/types/descriptor.d.ts:29-34`). | `engineEnabled: !isSubagent` (`lib/index.js:565`) — treats every `origin:'subagent'` child alike | A `continuable` child is functionally a resumable conversation, but the plugin excludes it from the engine path and its export. If DSH later routes continuable children through the engine, the plugin's classification is wrong for that class. | low | DSH: `dsh-subagent/lib/types/descriptor.d.ts:26-53`; `dsh-session/lib/types/types.d.ts:82-86`; plugin: `dsh-tokeneconomizer/lib/index.js:528, 565` |
| G-C-09 | C — upstream drift resilience | `dsh.manifestVersion` is **declared but not enforced** anywhere the loader reads it | "`dsh.manifestVersion` \| Manifest format identifier; the declared format is `1`, independent of the npm package version and Session format version." (`dsh-package-manifest/README.md`); the only occurrences in the whole install are the **type declaration** (`dsh-package-manifest/src/types.ts`, `lib/types/types.d.ts`) — `grep -rn "manifestVersion" <dsh>` excluding `node_modules` → **zero** hits | `manifestVersion: 1` is checked at load time | **Low** — a format change is not detected | low | DSH: `<dsh>/node_modules/@deepseek-ai/dsh-package-manifest/README.md`, `src/types.ts`, `lib/types/types.d.ts`; zero-match grep over `<dsh>` (excl. `node_modules`) and over `<dsh>/src`, `<dsh>/lib`. Plugin: `<plugin>/package.json:46` |
| G-C-15 | C — upstream drift resilience | No capability-**probe** API exists upstream; discovery is by **static catalog + runtime lookup** | `docs/capability-seams.md` is a *generated* static table (`:1-2`: "Generated by scripts/gen-doc-graphs.ts — do not edit by hand"); the only runtime lookups are `ctx.get` and `ctx.inject` (`docs/cordis-api/context.md:237`, `registry.md:8`) | a plugin can ask "does capability X exist?" in one call | **Low** — no probe API is missing; the plugin must compose probes from `ctx.get`/`ctx.inject` | low | DSH: `<dsh>/docs/capability-seams.md:1-2`, `:664` (the only `*Probe*` name is plugin-manager-specific). Plugin: `<plugin>/lib/index.js:470-476`, `:985-992`, `:502-510` (the existing manual probes) |

### 5.1 Summary by dimension and severity

| Dimension | Blocker | High | Medium | Low | Total |
|---|---|---|---|---|---|
| **A** — project / workspace isolation | 1 | 8 | 5 | 1 | 15 |
| **B** — session & subagent schemas | 1 | 4 | 5 | 2 | 12 |
| **C** — upstream drift resilience | 1 | 6 | 6 | 2 | 15 |
| **Total** | **3** | **18** | **16** | **5** | **42** |

Three blockers, one per dimension — which is itself the finding: **no dimension is safe alone.** Each
blocker is fatal in a different way, and the register has no single point of failure to fix first:

- **A** — `G-A-01`: DSH has **no project or repository entity**. The plugin partitions state per git
  repository; DSH groups sessions by a derived, lossy, path-derived directory name. The plugin's
  per-repo partition has no DSH-side durable anchor.
- **B** — `G-B-01`: the plugin writes the **identical** `compaction/prune` + `tool/result`-replace event
  pair as the shipped `dsh-compaction-tool-result-pruner`, with **no distinguishing field**. Any
  consumer attributing saved tokens by event shape cannot separate the plugin's tiering from the
  pruner's pruning. This is the measurement bug.
- **C** — `G-C-01`: the plugin's headline token-saving feature (tiering) rides on the **already
  deprecated** `agent/request` hook, which is its only trigger.

Severity distribution skews high (18 of 42). That skew is a property of the *measurement* rather than
of the plugin alone: a gap is only visible once the typed declaration and the plugin's use of it are
compared, and 18 of these are typed-contract divergences that no runtime test would have surfaced.

### 5.2 Reconciliation notes

Conflicts between the three dimensions were resolved by the evidence-tier rule stated in §1.2:
**typed declaration > readable source > real log > inference.** Every correction below is recorded
rather than silently applied.

**1. Dimension C corrected itself mid-flight, twice.** Its first reading reported that the DSH install
ships no `.d.ts` files and that the `session/event` event name is untyped. **Both were wrong.** The
runtime packages *do* publish typed contracts (`dsh-session` 10, `dsh-agent` 8, `dsh-tools` 10,
`dsh-system-prompt` 1, `dsh-session-*` more); the root `@deepseek-ai/dsh` package publishes 9 `.d.ts`
files. And `session/event` **is** a published typed contract — `session/event(this: Scoped<Session>,
session: Session, event: SessionEvent): void` at `dsh-session/lib/types/index.d.ts:66` (`@mode emit`),
with `agent/inbox/spliced` typed at `dsh-agent/lib/types/types.d.ts:97`. The residual risk on A21 was
therefore **shape**, not name. **Consequence: A21 was downgraded blocker → high**, and the
`UNVERIFIABLE` item in §8 that named `session/event` as untyped was withdrawn.

**2. `HeaderLine` has two distinct shapes — the single most confusable fact in the corpus.**
Dimension B established that the name refers to **two different declarations** that must not be
conflated:

| Shape | Where | Visibility |
|---|---|---|
| `HeaderLine` — the **on-disk** header | `dsh-session-persistence-jsonl/lib/types/format.d.ts:42-53` | module-private to the persistence package |
| `SessionHeader` — the **in-memory** header | `dsh-session/lib/types/types.d.ts:59-100` | public contract |

The plugin reads the header through `agent.session.header` (`lib/index.js:528`, `:546`), i.e. the
**in-memory** `SessionHeader`. Any statement in this brief or in the fragments about "`HeaderLine`"
must be resolved against the correct one of the two before it is used as a design premise.

**3. Dimension A established that the plugin caches `state.cwd` once and never handles a working-
directory change.** The plugin reads `agent.session.header.cwd ?? process.cwd()` into `state.cwd` at
`lib/index.js:546` and reuses that cached value at `:718`, `:779`, `:783`, `:796`, `:800`. It does not
listen for `working-directory/change`, and `grep` over `lib/index.js` for that event name returns
**zero hits**. DSH ships `dsh-working-directory` with a session-scoped mutable cwd (§3.8). The
consequence is that the plugin's project partition can go stale inside a live session.

**4. Cross-dimension overlaps were merged, not duplicated.** Where two fragments described the same
underlying divergence from different angles, the row was kept once with the strongest evidence and the
second angle became a cross-reference:

| Gap | Dimension A / C view | Dimension B view | Kept |
|---|---|---|---|
| `G-A-01` vs `G-A-02` | DSH has no repo entity; slug is lossy | — | A (project identity is A's subject) |
| `G-A-11` (cwd cached once) | cwd is raw/non-canonical; proxy cwd | — | A |
| `G-C-01` (deprecated trigger) | — | `G-B-06` (`agent/request` deprecated) | **both** — C grades the drift risk, B grades the contract |
| `G-C-06` (bare service access) | `A.4` service scoping keys | `G-B-06`-area deprecation notices | both, different subjects |
| `G-C-04` (append overload) | — | `G-B-05` (3-arg append undeclared) | both — B owns the declaration fact, C owns the flux |

**5. Severity grades are the fragments' own, with one documented correction.** Grading was done
per-dimension against the *same* rubric (blocker = the plugin's headline value or a measurement
delivers wrong; high = a silent wrong answer; medium = a feature degrades; low = cosmetic or
unreachable). Cross-dimension grades were **not** re-levelled after merging, because re-grading on a
second rubric would have made the two dimensions incomparable. The one exception is A21 (above),
which was re-graded because its *evidence* changed, not because a second opinion was applied.

### 5.3 Cross-dimension compound risks

These are risks that are **invisible inside any one dimension** — each depends on two or more gaps
from different dimensions firing together. They are the reason this brief is a single document.

**R1. Project-key divergence (A) × missing producer discriminator on `compaction/prune` (B) ⇒ both
per-project ledger partitioning *and* rewrite attribution are unreliable at the same time.**
Dimension A establishes that the plugin's partition key (a git repo key, `G-A-01`, `G-A-02`,
`G-A-06`) has **no durable DSH-side anchor** — it must be re-derived by re-running git discovery
over every session header, and any mismatch silently creates a new bucket. Dimension B establishes
that the plugin's rewrite events are **byte-identical** to the shipped pruner's, with no producer
field (`G-B-01`). Composed: the plugin cannot answer "did this save tokens in *this* project?"
because the numerator (saved tokens) cannot be attributed to a producer, and the denominator (which
project) cannot be anchored to a durable key. The two failures are in different subsystems and would
be triaged by different people — yet they land in the same number. `INFERRED` composition; both
components are directly stated.

**R2. Deprecated `agent/request` (C) as the tiering trigger × the `surfaceOp` rewrite contract (B) ⇒
if the trigger seam retires, the lever dies silently while statistics keep reporting.**
`G-C-01` states the trigger is deprecated and DSH's compatibility contract is "keep it working,
warn once" — i.e. **no failure is raised when it is removed**. `G-B-03` states the rewrite is
appended from inside the `agent/request` waterfall with no documented permission or lease, and that
the plugin's `try/catch` at `lib/index.js:884` swallows any append rejection as "fail open".
Composed: the removal of the trigger produces **no error anywhere** — the plugin still mounts, still
counts turns (`state.turn` is still updated by `onEvent` at `:775`), and still publishes statistics
that now report zero tiering saving while the saving is simply absent. `INFERRED` composition; both
components are directly stated.

**R3. `origin` is "presentation metadata" (B) yet gated on 100% (C) ⇒ a future agent-team role value
would be silently treated as root.**
Dimension B quotes the contract verbatim: `origin` is "Coarse product classification for a session
created as a subagent child. **This is presentation metadata, not proof that the child is
continuable**" (`dsh-session/lib/types/types.d.ts:82-86`), and the plugin branches on it as ground
truth (`G-B-02`, `lib/index.js:528`, `:544`). Dimension C observes that `origin?: 'subagent'` has
**exactly one** legal value today, and that any second origin value makes the plugin treat the child
as root (`G-C-12`, `G-A-11`). Composed: the plugin is 100% certain about a field DSH explicitly
labels as non-authoritative. The corpus already shows the two axes can disagree — `G-B-11` records
that the real mode lives in the `subagent/descriptor` event (`mode: 'one-shot' | 'continuable'`),
which is log-only and not part of the header at all. A `dsh-agent-team` child with no `origin` field
would be classified as root, run the root-only engine path, double-count turns and write an
unwanted export — precisely the failure the plugin's own comment at `:532-540` says must not happen.
`INFERRED` composition; the axis divergence is directly stated by B (`G-B-02`) and the single-value
taxonomy by C (`G-C-12`).

**R4. Proxy cwd handling (A) × `surfaceOp` replacement targeting current nodes (B) ⇒ a mid-session
directory change could rewrite the wrong surface.**
Dimension A establishes that the plugin caches `state.cwd` once at `lib/index.js:546` and never
handles `working-directory/change`, while `ctx.workingDirectory` is a **session-scoped mutable cwd**
(§3.8, `dsh-working-directory/lib/index.js:56-57`). Dimension B establishes that the replacement
contract targets **currently-materialized surface nodes**: exactly one shadowed node, the target must
currently be a `tool/result`, and the replacement may change **only** `data.message.content` (§3.5,
`B.5.4`, `B.5.6`). Composed: if the session's working directory changes mid-session, the plugin's
cached cwd (and therefore its project partition and its export path) no longer matches the session,
while the `surfaceOp` replacement still resolves against the live surface — so a rewrite could be
attributed to the wrong project even though the rewrite itself is contract-valid. `INFERRED`
composition; both components are directly stated.

**R5. Cross-package ownership of `compaction/prune` (C) × the surfaceOp ordering MUST (B) ⇒ the
rewrite can be rejected on ordering while the plugin reports it as "nothing to tier".**
`G-C-03` states `compaction/prune` is owned by `@deepseek-ai/dsh-compaction`, not by core
`dsh-session`, and the plugin declares **no dependency** on that package (`G-C-14`). The owning
contract adds an ordering MUST — "The replacement MUST be appended synchronously right after this
event" (`dsh-compaction/src/types.ts:80`) — and DSH's own pruner writes the identical pair
(§3.5, `B.5.9`). Composed: the plugin and the shipped pruner race to own the same node, and if the
ordering MUST is violated the append throws; the plugin's `catch` at `:884` swallows it, and
`G-C-07` records that this fail-open emits **no notice**. The result is that the plugin and the
pruner both claim the same token saving, and neither reports a conflict. `INFERRED` composition;
both components are directly stated.

**R6. No deprecation-detection channel (C) × a rename that keeps the shape (B) ⇒ drift is invisible
until the feature is already wrong.**
`G-C-02` states the plugin has **no** deprecation-detection channel: it is plain JavaScript, its
`check` script is `node --check` (syntax only), and the compiler channel DSH documents
(`no-deprecated` findings) is unavailable to it. `G-C-08` adds that its `engines.dsh` range
(`">=0.2.2-alpha.2 <0.3.0"`) is wide enough to let 14 documented in-range breaking changes through,
and `G-C-09` that `manifestVersion` is declared but **never validated** anywhere in the loader.
Composed: a rename that preserves the *shape* the plugin reads passes every gate the plugin has,
so the drift surfaces only as wrong behaviour — the plugin still runs, still reports, and the
error surfaces in the saved-token statistic. `INFERRED` composition; all four components are
directly stated.

## 6. Hard-assumption inventory

33 assumptions the plugin makes about the DSH surface, each with what breaks on an upstream change,
whether the failure is **loud** or **silent**, and a severity. The most severe single assumption is
**A1** (`index.js:686`, `agent/request` as the sole tiering trigger); the second is **A11**
(`index.js:528`, `header.origin` as the subagent discriminator); the third is **A12**
(`index.js:1285` / `bridge.js:219`, the session export as a byte-level copy of DSH's format).

**Legend.** **Loud** = the failure surfaces as an error/throw/visible notice at the call site.
**Silent** = the plugin degrades without any error, losing a feature or a token saving.
**Silent-no-op** = the branch is simply never taken.

| # | Plugin file:line | Assumption (category) | What breaks on upstream change | Loud/Silent | Severity |
|---|---|---|---|---|---|
| **A1** | `index.js:686` — `state.agent.ctx.on('agent/request', async (payload, next) => { … state.turn = payload.turn … })` | **assume-shape + assume-field-name** (event name + `payload.turn`) | `agent/request` is **already deprecated upstream** (`docs/upgrade-guide/v0.2.1-alpha.4/session-model-selection/guide.md:16`: "`agent/request` is deprecated"). It currently still fires, but its payload contract is frozen: per `docs/architecture.md:114` it "adjusts controls without changing the provider, model, or effort selection". If the loop retires or renames the hook, **the tiering rewrite never runs** — `state.turn` is never updated from the request waterfall, and `applyTiering` (`index.js:818`) is only ever invoked from this one listener (`:692`). Tiering then silently stops tiering every old tool result out of the model context. Note the *silent* character: even if the hook stops firing, `state.turn` is still updated by `onEvent` at `:775` (`event.type === 'turn/start'` → `state.turn = event.data.turn`), so the plugin still *looks* alive and its statistics still report turns. | **SILENT** (feature dies; no error) | **blocker** |
| **A2** | `index.js:698` — the listener returns `next()` and never inspects the returned `LlmCallConfig` | **assume-optional-returns** | The typed contract is `(payload, next) => Promise<LlmCallConfig>` (`dsh-agent/lib/types/runtime-types.d.ts:363-368`). The plugin's tiering *depends on the waterfall running before assembly* (the comment at `index.js:683-685`: "Tiering rewrites the surface, which cannot run while `turn/start` is being appended. The request waterfall runs after that append and before the request is assembled, so the rewrite reaches this turn's first call."). If upstream reorders the waterfall relative to prompt assembly, the rewrite lands **one step late** — the model sees the un-tiered output for that turn, then the tiered version from the next turn on. | **SILENT** (one-turn-late, self-correcting) | medium |
| **A3** | `index.js:872-876` — `session.append('compaction/prune', { shadowedRange: {start,end}, shadowedSeqs: [seq], shadowedTokenCount })` | **assume-field-exists + assume-shape + cross-package ownership** | `compaction/prune` is **not** in the core `SessionEventMap` (`dsh-session/lib/types/types.d.ts:261` lists `turn/start`, `turn/end`, `step/start`, `step/end`, `user/message`, `system/message`, `assistant/message`, `tool/call`, `tool/result`, …). It is declared in a **different package**, `@deepseek-ai/dsh-compaction` (`dsh-compaction/src/types.ts:82-89`), merged in via "plugin-merged extensions included" (`dsh-session/lib/types/types.d.ts:442`). The owning contract also states: "The replacement MUST be appended synchronously right after this event" (`dsh-compaction/src/types.ts:80`). If `@deepseek-ai/dsh-compaction` is not composed, or the type is renamed, `session.append` **throws** — the plugin's `try/catch` at `:871-884` catches it and continues, so the tiering rewrite is skipped **for that node only**. | **LOUD inside, SILENT outside** (caught; the tiered replacement is simply not applied) | **high** |
| **A4** | `index.js:877-880` — `session.append('tool/result', { ...event.data, message }, { surfaceOp: { op: 'replace', startSeq: seq, endSeq: seq }, sourceEventSeqs: [seq] })` | **assume-shape** (exact `surfaceOp` / `sourceEventSeqs` option names and the `replace` op) | `dsh-session/lib/types/index.d.ts:273-283` (append docblock) and `types.d.ts:494-521` make `surfaceOp` **REQUIRED** for `SurfaceEventType` events and **rejected by the compiler** for non-surface types. If the option name or the `replace` op shape changes, the append throws (`"canonical surface contract (marker shape and eligibility, unique earlier source-event references, positional replacement validity, and complete shadowed-node coverage)"` — `index.d.ts:291-293`). Caught by `:884` → tiering skipped for that node. | **LOUD inside, SILENT outside** | **high** |
| **A5** | `index.js:774-775` — `if (event.type === 'turn/start') { state.turn = event.data.turn }` | **assume-field-exists** (unguarded `event.data.turn` — no `?.`) | `turn/start`'s payload is typed `{ turn: number }` (`dsh-session/lib/types/types.d.ts:268-270`), so the field is contractual today. But `event.data` is read **unguarded** here while every other read in the same function uses `event.data?.…` (`:785`, `:842`, `:853`, `:861`, `:951`). If a `turn/start` arrives without `data` (e.g. a session-log replay, a migration-synthesized event, or an upstream change to a log-only `turn/start`), this throws a `TypeError` **inside the `session/event` listener** — which runs synchronously inside the Session's publication path. | **LOUD** (TypeError in the event listener) but **not caught by the plugin** — no try/catch at `:774` | **high** |
| **A6** | `index.js:785` — `event.data?.source?.kind === 'user'` | **assume-field-name** (string key `source.kind`) | `user/message`'s payload is `UserMessage` (typed, `dsh-session/lib/types/types.d.ts:300`), and `source` "tells them apart" (a direct human prompt vs. a synthetic `agent.inject()` context vs. an entered goal continuation). The plugin *reads* `source.kind` but the **kind values are string literals** it also *writes*: `MESSAGE_SOURCE = Object.freeze({ kind: 'tokeneconomizer' })` (`index.js:329`). If upstream renames `'user'` → something else, the plugin stops recognising a genuine human prompt: `recallPrior` never fires (`:951-958` also uses `source?.kind`), and the loop-breaker reset at `:788-789` never runs — so a repeated prompt no longer resets the breaker. The plugin's own injected messages use `kind: 'tokeneconomizer'` (`index.js:329`) — a **self-defined** value that DSH does not know about, so `isOwnNotice` (`index.js:349`) is the only thing keeping them out of the progress accounting. | **SILENT** | **high** |
| **A7** | `index.js:951-952` — `const source = event.data?.source?.kind; const genuine = source === undefined \|\| source === null \|\| source === 'user'` | **assume-field-name** + **assume-optional-returns** | Same field-name risk as A6, but the *fallback* is `source === undefined` → treated as genuine. If upstream **adds** a new non-human source kind (e.g. `'goal-continuation'`), the plugin treats it as genuine and burns the one-shot recall budget on a non-human message (`:957` `state.recallDone = true`). Recall then never runs for the real prompt. | **SILENT** (recall silently lost for that session) | medium |
| **A8** | `index.js:902` — `state.calls.set(String(event.data.callId), { turn: event.data.turn, step: event.data.step })` | **assume-field-exists** (unguarded, inside `observeMemory`) | `tool/call` payload is typed `{ turn, step, callId, name, arguments }` (`dsh-session/lib/types/types.d.ts:362-367`). `event.data.callId` is read unguarded. If `callId` is renamed or moved (e.g. into `data.message.source.callId`, which the plugin *does* read for `tool/result` at `:853` — `event.data?.message?.source?.callId ?? event.data?.message?.toolCallId`), then: (a) `String(undefined)` → the literal key `"undefined"` collides across all calls; (b) `state.meta` (`:908-911`, keyed by the same `callId`) fills with `name: undefined`, so `classifyTool(meta?.name, meta?.arguments)` (`:855`) classifies every tool as unknown → the tier-2 "structural index" is produced for *code reads*, which the plugin explicitly must never summarize (`index.js:812-813`: "Code reads are never summarized in tier 2: they are the work, not noise"). | **SILENT** (wrong tier content, no error) | **high** |
| **A9** | `index.js:908-911` — `state.meta.set(String(event.data.callId), { name: event.data.name, arguments: event.data.arguments })` | **assume-field-name** (`callId`, `name`, `arguments` on `tool/call`) | Same as A8. `arguments` is typed `string` (`types.d.ts:366`); the plugin passes it to `classifyTool` (`index.js:855`, `1105` `arguments: exec.arguments ?? {}`) — a **string** on one path and an **object** on the other (`exec.arguments` from the tool executor). If `tool/call.arguments` becomes a parsed object, `classifyTool` receives a different shape than at `:1105`. | **SILENT** | medium |
| **A10** | `index.js:853` — `const callId = event.data?.message?.source?.callId ?? event.data?.message?.toolCallId` | **assume-shape + assume-field-name** (two different call-id locations) | The plugin reads the tool-result call id from **`message.source.callId`** with a fallback to **`message.toolCallId`**. The `tool/result` payload type declares `message: ToolResultMessage` (`types.d.ts:382-386`) but the *inner* call-id location is not part of the core `SessionEventMap` declaration verified here. If upstream moves the call id to a third location, `callId` is `undefined` → `state.meta.get(String(undefined))` misses → `meta?.name` is `undefined` → `classifyTool(undefined, undefined)`. | **SILENT** | medium |
| **A11** | `index.js:546` — `const cwd = agent.session.header.cwd ?? process.cwd()`; `index.js:528` — `agent.session.header.origin === 'subagent'` | **assume-field-exists + assume-field-name** | `header.cwd` is typed `readonly cwd?: string` (**optional**) and `header.origin` is typed `readonly origin?: 'subagent'` (**optional**) (`dsh-session/lib/types/types.d.ts:70,86`). `cwd` is guarded with `??` (good). `origin` is **not** guarded but `=== 'subagent'` on `undefined` is false — safe *today*. However `origin` has exactly **one** legal value in the type: `'subagent'`. If upstream adds another origin (e.g. `'team'`, `'workflow'`), the plugin treats it as a root session and **runs the engine path for it** — double-counting turns and writing a session export for a child, which is exactly the failure the comment at `index.js:532-540` says must not happen. | **SILENT** | **high** |
| **A12** | `index.js:1285` — `header: session.header` and `index.js:1286` — `events: session.snapshotEvents()`; `bridge.js:219` — `join(dir, \`${session.header.id}.jsonl\`)` | **assume-shape** (the export envelope mirrors DSH's own session-log format) | The export is a **byte-level copy of DSH's session format** (`{ header, events }`) fed to a Python engine. `<dsh>/docs/capability-seams.md:702` states: "The JSONL backend persists the SessionEvent vocabulary as one artifact per Session." The DSH session format has already migrated at least three times — the install ships `dsh-session-format-v0-to-v1`, `v1-to-v2`, `v2-to-v3` packages, and `dsh-session-format-v2-to-v3/src/validation.ts` references `compaction/prune`. A format migration that changes `header` fields or event payload shape propagates into this file **without any type or version check**. `bridge.js:219` will then write `undefined.jsonl` if `header.id` disappears. | **SILENT** (a file named `undefined.jsonl`, or an export the Python engine cannot parse) | **high** |
| **A13** | `index.js:663` — `state.agent.ctx.systemPrompt.section(pinnedSection(pinned, config.pinnedRulesOrder))`; `index.js:726` — `state.agent.ctx.systemPrompt.context({ name: 'tokeneconomizer:microskills', order: MICROSKILLS_CONTEXT_ORDER, text: () => text })` | **assume-optional-returns** (assumes `section()` and `context()` exist on the service) | Both are typed (`dsh-system-prompt/lib/types/index.d.ts:256` `section(section: PromptSection): () => void`; `:275` `context(context: PromptContext): () => void`), so they are contractual. But the plugin calls them **unconditionally** with no `typeof` guard — unlike its own `ctx.get` sites. If the service is present but the method is renamed, this throws inside `mount(state)` (called from the `agent/created` handler at `:527`) → the **whole per-agent mount fails**, taking the pinned prompt, the microskills context, the tool observers, the tiering and the watchdog with it. | **LOUD** (throws during `agent/created`) | **high** |
| **A14** | `index.js:739` — `if (deny.length) state.agent.ctx.tools.restrict({ deny })` | **assume-optional-returns** + **assume-field-name** (`restrict` + `deny` key) | `restrict(filter: ToolRestriction): () => void` is typed (`dsh-tools/lib/types/index.d.ts:58`), and the filter shape is `ToolRestriction` — the plugin passes `{ deny }`. The typed contract also documents "the exact disposer that lifts this restriction" — the plugin **discards** the disposer (`:739`), so a later upstream change that requires explicit release before re-restriction would leave the tool mask permanently applied to that agent scope. | **LOUD** if `restrict`/`deny` is renamed (throws during `start()`); **SILENT** if the restriction lifetime changes (mask leaks) | medium |
| **A15** | `index.js:719` — `const tools = ctx.tools.definitions().map((def) => def.name)`; `index.js:737` — `const visible = new Set(ctx.tools.definitions().map((def) => def.name))` | **assume-optional-returns** (assumes `definitions()` returns objects with `.name`) | `definitions(scope?: ScopeKey, toolSet?: ResolvedToolSet): readonly ToolDefinition[]` is typed (`dsh-tools/lib/types/index.d.ts:102`). If upstream changes `ToolDefinition.name` (e.g. to `id`), the tool list passed to the engine `brief()` call (`:720-723`) is `[undefined, …]`, and the deny-list computation at `:737` compares `undefined` against real tool names — so the **deny list stops matching** and the tool pruning silently stops pruning. | **SILENT** (the engine brief gets a garbage tool list; the deny list matches nothing) | medium |
| **A16** | `index.js:823-824` — `const meter = ctx.tokenMeter; if (!meter?.estimateMessage) return` | **assume-optional-returns** — **the only properly guarded structural seam** | `estimateMessage(message: Message): number` is typed (`dsh-token-meter/lib/types/index.d.ts:64`). The `?.` guard means: if the method disappears, **tiering silently stops** (`applyTiering` returns at `:824`) with **no notice at all**. This is a guarded fail-open that is indistinguishable from "nothing was tiered". | **SILENT** (no notice) | medium |
| **A17** | `index.js:666-868` — the token accounting `const shadowTokens = meter.estimateMessage(original)`; `state.stats.tierShadowTokens += …` | **assume-optional-returns** (numeric return contract) | `estimateMessage` returns `number` (typed). The plugin guards with `Number.isFinite(Number(shadowTokens)) ? Number(shadowTokens) : 0` (`:882`) — defensive and correct. If the return became an object `{ tokens }`, `Number({tokens:5})` is `NaN` → the counter stays `0` and the plugin reports **zero savings** while actually saving tokens. | **SILENT** (metrics lie, savings still happen) | low |
| **A18** | `index.js:479-484` — `registry.snapshot(session, ['tokenUsage','contextPressure','contextBreakdown','sessionStats'])` | **assume-field-name** (projection **key strings**) | `snapshot(session, keys)` is typed, but the **keys** are string literals the plugin owns. `sessionStats` "appears when the host's session-stats plugin is composed" (the plugin's own comment at `index.js:462-464`) — i.e. the plugin already knows the key set is composition-dependent. Worse: `contextPressure` and `contextBreakdown` are `SessionProjectionSummaryExcluded` in the session.list summary (`dsh-token-meter/lib/types/projection.d.ts:69,71`), and `docs/upgrade-guide/v0.2.2-alpha.2/projection-snapshot-scope/guide.md:12` records that "A plugin can no longer rely on other units being computed after it calls `snapshot`". If a key is renamed, `snapshot` simply returns fewer units → `values` lacks them → the dev-stats panel shows **zeros**, with no error (the whole read is wrapped in `try/catch` at `:478-488` returning `null`). | **SILENT** | medium |
| **A19** | `index.js:1006` — `eventFilters: [{ kind: 'type', values: ['user/message', 'assistant/message'] }]` | **assume-field-name** (event **type strings** as search filter values) | `searchSessions(request: SessionSearchRequest, exec?)` is typed (`dsh-session-query/lib/types/index.d.ts:63`) but the `SessionSearchRequest` filter shape and the event-type strings are **runtime values**. If a type is renamed (e.g. `user/message` → `user/input`), the filter matches **zero events** → `page.items` is empty → recall silently finds nothing. | **SILENT** (recall silently returns nothing) | medium |
| **A20** | `index.js:1013-1026` — `hit?.header?.id`, `hit?.header?.cwd` | **assume-shape** (search-hit header shape) | The plugin reads the hit header as `{ id, cwd }`. `hit.header.cwd` is optional in the Session header type (`types.d.ts:70`), and the plugin **does** guard it (`:1017` `if (typeof cwd !== 'string' \|\| !cwd) return false`). If the hit shape changes (e.g. `hit.sessionId` instead of `hit.header.id`), the plugin's self-exclusion filter (`:1014`) stops excluding the current session → the plugin **recalls its own session back into itself** (a self-quoting loop). | **SILENT** | medium |
| **A21** | `index.js:682` — `state.agent.ctx.on('session/event', (session, event) => onEvent(state, session, event))` | **assume-field-name** (the **event name** `session/event` itself) — *CORRECTED after verification* | The event name **is** a published contract: `'session/event'(this: Scoped<Session>, session: Session, event: SessionEvent): void` at `dsh-session/lib/types/index.d.ts:66` (`@mode emit`). So the *name* is contractual; the residual risk is **shape**, not name: `event` is the typed `SessionEvent` union, so `event.type` must be one of the `SessionEventMap` keys (`types.d.ts:261`) and `event.data` must match that key's declared payload. `onEvent` matches on **six** type strings — `'turn/start'`, `'user/message'`, `'turn/end'` (`index.js:774,784,791`), `'tool/call'`, `'tool/result'`, `'system/message'`, `'assistant/message'` (`:901,920,924,932`) — and `isOwnNotice` (`index.js:349`) additionally matches `'agent/inbox/spliced'` via `data.inserted[].source.kind` (typed at `dsh-agent/lib/types/types.d.ts:97`). If upstream renames or removes **any** of these type keys, the corresponding branch **silently stops firing** — e.g. removing `turn/end` kills the engine's `Stop` hook (`:794-800`) *and* `scheduleExport(state)` (`:801`); removing `assistant/message` kills the `state.requests` counter (`:933`) and therefore the route diagnostic at `:1301-1303`. The event **name** is safe; the **type-key set** is the assumption. | **SILENT** (per-type-key feature loss) | **high** |
| **A22** | `index.js:520` / `:665` — `ctx.on('tools/post-execute', …)` and `ctx.on('tools/result', …)` | **assume-field-name** (event names) + **assume-ordering** | Both are typed (`dsh-tools/lib/types/events.d.ts:40,48`), so the names are contractual. The **ordering** assumption is the plugin's: the root-level listeners at `:516-526` are described in the plugin's own comment (`:512-514`) as "the routing verification: they count what a listener on the plugin's own context receives, next to the counts of the agent-scoped listeners above." The plugin counts deliveries in **both** scopes (`DELIVERY.agentPost`, `DELIVERY.agentResult`, `DELIVERY.rootResult`) and compares them at session end (`:1301-1303`: "no tool event reached the bridge in ${state.requests} requests"). If upstream changes **dispatch scope** (e.g. agent-scoped listeners no longer receive root events), the counts diverge. | **SILENT** (the diagnostic at `:1301` fires with a misleading message, or does not fire at all) | medium |
| **A23** | `index.js:527` — `ctx.on('agent/created', async ({ agent, source }) => { … })` — the handler is `async` | **assume-ordering** (the plugin assumes the agent is fully usable and that its listeners are registered before any event of the session is missed) | The typed contract says `'agent/created'` is `@mode serial` (`dsh-agent/lib/types/runtime-types.d.ts:254`) and "Scope-filtered dispatch … `agent/created` listeners before releasing queued work. The sequence is …" (`dsh-agent/lib/types/index.d.ts:156`, `:299`, `:325`). The plugin's own comment at `index.js:706-708` states: "The listeners of the session were registered by `mount` before this call, so no event of the session is missed." That guarantee is **upstream's**, not the plugin's — the plugin registers `mount(state)` listeners *inside* the `agent/created` handler and relies on the agent not dispatching `turn/start` before the serial `agent/created` waterfall completes. If upstream starts the agent loop concurrently with `agent/created`, the plugin **misses the first `turn/start`** → `state.turn` stays `0` → `applyTiering` returns early at `:822` (`if (!currentTurn) return`) → tiering is off for that turn, and the engine's `UserPromptSubmit` hook at `:777-783` fires with `state.prompt === ''`. | **SILENT** | **high** |
| **A24** | `index.js:1135` / `:1181` — `state.agent.cancel({ kind: 'hook', reason: 'tokeneconomizer/loop-breaker' }, { keepInbox: true })` | **assume-shape** (untyped `cancel` argument) | I located **no** published `.d.ts` declaring the `cancel(cause, opts)` argument shape (the `kind`/`reason`/`keepInbox` triple is plugin-local knowledge). The typed `SessionEventMap` declares a "Durable cancellation cause" (`dsh-session/lib/types/types.d.ts:163`) but not the `agent.cancel` call signature verified here. If upstream renames `keepInbox` or changes `kind`'s allowed values, the call may throw (inside `breakLoop`/`onWatchdogTimeout`) or may silently cancel **with** the inbox preserved — i.e. the loop-guard's own prompt is dropped and the turn continues. | **LOUD if it throws; SILENT if the semantics change** | medium |
| **A25** | `index.js:1030`, `1130`, `1223`, `1388` — `state.agent.inject(userMessage(block))` | **assume-shape** (the injected message's block shape) | `agent.inject()` is documented in the Session event vocabulary as producing "a synthetic `agent.inject()` context" that lands as a `user/message` (`dsh-session/lib/types/types.d.ts:300`). The plugin's own injected blocks use `MESSAGE_SOURCE = { kind: 'tokeneconomizer' }` (`index.js:329`) — a **kind value DSH does not define**. The plugin then *depends* on that value in `isOwnNotice` (`index.js:349`) to keep its own messages out of the watchdog's progress accounting (`:961`, `:968` — "the plugin's own notices are not activity"). If upstream adds source-kind validation or normalizes unknown kinds, the plugin's injected messages either get rejected or lose their `kind`, and the watchdog then **counts its own notices as progress** — reproducing the exact regression the plugin's comment at `:964-967` records ("measured 2026-11-02: 24 warnings, 0 interrupts"). | **SILENT** (watchdog never interrupts) | **high** |
| **A26** | `index.js:1135`, `1181` — `state.agent.cancel(...)` is called *after* `state.agent.inject(...)` at `:1130` / `:1223` | **assume-ordering** | The loop-breaker injects a corrective prompt and then cancels the turn. If upstream dispatches the cancel before the injected message is committed to the session, the injected prompt is lost (the turn ends with no correction) — the loop guard then trips again on the next turn with no explanation to the user. | **SILENT** | medium |
| **A27** | `index.js:834-843` — `for (const seq of [...nodes]) { event = session.eventAt(seq); if (event?.type !== 'tool/result') continue; const turn = event.data?.turn ?? 0 }` | **assume-ordering** (surface-node order ⇒ chronological turn order) | The tiering grades a tool output by `tierForTurn(turn, currentTurn, policy)`. It reads the turn from the *event*, not from the node position, so the ordering assumption is that **`surface.nodes` contains only `tool/result` nodes for the turns that matter**. `surface` is a *replacement-aware* projection (`dsh-session/lib/types/surface.d.ts:55-60`: a replacement "shadowed an existing surface range instead of appending to the tail"). If upstream keeps shadowed nodes in `surface.nodes` (rather than removing them), the loop re-tiers already-replaced nodes: `eventAt(seq)` for a shadowed node returns the *original* `tool/result`, and the plugin appends a **second** replacement for the same seq → duplicate replacements and a shrinking surface. | **SILENT** (surface corruption, no error) | **high** |
| **A28** | `index.js:748` — `if (state.agent.session.snapshotEvents().length > 0)` | **assume-field-exists** (assumes `snapshotEvents()` reflects "a resumed or forked session already has a log") | `snapshotEvents(fromSeq?, toSeqExclusive?): readonly SessionEvent[]` is typed (`dsh-session/lib/types/index.d.ts:232`). The plugin infers "resumed/forked" from a **non-empty event list**. A freshly created session that already has one synthetic event (e.g. a `request/header` or a projection marker) would take the "already has a log" branch and export a transcript at SessionStart. | **SILENT** | low |
| **A29** | `client.js:642` — `ctx.slots.inject('settings.section', () => ctx.slots.register({ name: 'settings.section', id: 'tokeneconomizer-devstats', order: 62, label: () => t('devstats.title') }, DevStatsSection))` | **assume-field-name** (the **slot name string** `'settings.section'`) | The slot name is a **string literal** on both sides. The plugin's `package.json` `dsh.client.inject` declares `@deepseek-ai/dsh-client-ui-settings` (`package.json:54`), but the *slot name* `'settings.section'` is not a typed contract. If upstream renames the slot, `ctx.slots.inject('settings.section', …)` never resolves → the dev-stats settings section **silently does not appear** in the UI. No error on the client. | **SILENT** | medium |
| **A30** | `client.js:642` — `ctx.locale.subscribe(...)` / `ctx.locale` | **assume-optional-returns** (unguarded client service) | `dsh.client.inject` declares `@deepseek-ai/dsh-client-locale` (`package.json:55`), so `ctx.locale` should exist — but the client bundle is composed by the **Client** module graph (`ctx.clientModules`, `capability-seams.md:760`), not by the Host, so the two can diverge. If `ctx.locale` is absent, `ctx.locale.subscribe` throws during the client module's apply → the settings section never registers. | **LOUD** (client-side throw) | medium |
| **A31** | `index.js:825-831` — the `policy` object `{ hotTurns, warmTurns, headChars, tailChars, minChars }` and `index.js:474-484` — the projection key list | **assume-field-name** (config-key names shared between the patch row, the settings file and the code) | `config.tierHotTurns` etc. are read through `resolveConfig` (`index.js:258`), which tolerates both a schemastery accessor and a plain value. The plugin's **settings file** (`lib/settings.js`, merged at `index.js:425-428`) is a **second, independent** source of these keys, merged *on top of* the Cordis config. A key rename in one of the three places (patch row / settings file / code) is silently ignored by the others. | **SILENT** (a feature runs at a default value the user did not set) | medium |
| **A32** | `index.js:470` — `if (typeof ctx.get !== 'function') return null` | **assume-optional-returns** — **correctly guarded** | `ctx.get` is a Cordis contract (`docs/cordis-api/context.md:237`). The guard is right. Recorded as the *positive* control: this is the pattern the plugin should apply to the seams it currently uses bare. | n/a (defensive) | — |
| **A33** | `index.js:505-507` — `try { ctx.inject(['connection'], mountDevStats) } catch { mountDevStats() }` | **assume-optional-returns** — **correctly guarded** (fail-open) | Cordis contract (`docs/cordis-api/registry.md:8`). Recorded as the positive control for optional seams. | n/a (defensive) | — |

**Notes carried from the fragment.**

- **A32 and A33 are positive controls**, recorded as *"correctly guarded"* — `ctx.get` is probed with
  `typeof` before use, and `ctx.inject([connection], …)` is wrapped in a `try/catch` that falls back
  to the no-op path. These are the pattern the plugin should apply to every seam it currently uses bare.
- **A21 was corrected during measurement** (see §5.2, item 1): the event *name* `session/event` **is**
  a published contract; the residual risk is the event *shape*.
- **A11 and A12** are listed here with the note that `header.cwd` is guarded with `??` (good) while
  `header.origin` is **not** guarded — safe today only because `'subagent'` is the sole legal value.

## 7. Recommended architectural direction (constraints only)

**This section constrains; Stage 2 designs.** It states what any architecture that fixes §5 and
survives §6 *must* satisfy. It deliberately contains **no target architecture** — no component list,
no data-flow design, no schema proposal. The design that satisfies these constraints is Stage 2's
deliverable, and pre-empting it here would defeat the purpose of the split.

The constraints below are drawn from fragment C's C.7 (drift-defense constraints, rationale-bearing)
and fragment A's A.6b (multi-project partitioning recommendation), plus the compound risks in
§5.3. Each is tied to the gap IDs it discharges.

### 7.1 Project identity

**C1 — There must be exactly one canonical project-identity resolution path; a fourth scheme is not
acceptable.** The candidates are already enumerated and measured in §3.1: DSH's `projectKey(cwd)` is
per-directory and lossy; DSH's `WorkspaceId` is canonical and stable but not derivable from a header
alone; the DSH session id is one per session, not per project; the engine's `repoKeyFor(cwd)` is
repo-level and subdir-invariant but needs git discovery. A design that picks a *different* key a fourth
time, or that carries two keys without a stated precedence, reproduces `G-A-01` with extra steps.
Discharges: `G-A-01`, `G-A-02`, `G-A-06`, `G-A-11`.

**C2 — The project key must be persisted *with* the data it keys; it must never be recomputed from a
path later.** Every failure mode in R1 follows from a key that is re-derivable. A key that must be
re-derived by re-running git discovery over every session header is a key that can change under the
data, and the mismatch is silent — it creates a new bucket instead of erroring. Discharges: `G-A-01`,
`G-A-02`, `G-A-04`, `G-A-06`, `G-A-11`.

**C3 — `working-directory/change` must be handled.** The plugin caches `state.cwd` once at
`lib/index.js:546` and never listens for the event (§5.2, item 3). A session-scoped mutable cwd is a
DSH contract (`ctx.workingDirectory`, §3.8), so the cached value is stale by construction after the
first directory change. Discharges: `G-A-03`, `G-A-11`, R4.

### 7.2 Capability discovery and drift

**C4 — No bare property access on a contract-tier seam; probe capability first.** The plugin already
demonstrates the pattern (`ctx.get` + `typeof` + `try/catch`, A32/A33) but applies it only to the
seams it added late. DSH offers exactly three structural discovery mechanisms — hard `inject`,
`ctx.get` → `undefined`, and deferred `ctx.inject` (§3.9) — and there is **no** capability-probe API
upstream (`G-C-15`), so probes must be composed from those three. Discharges: `G-C-06`, `G-C-15`, and
the `A13`/`A14`/`A15`/`A16` family in §6.

**C5 — The tiering trigger must not depend on a deprecated seam.** `agent/request` is already
deprecated upstream *today*, DSH's compatibility contract is "keep it working, warn once" — so the
removal raises **no error**. A design that keeps `agent/request` as the trigger must carry an explicit,
tracked liability and a stated replacement path; a design that replaces it must not assume a
version service exists (the runtime version is not exposed to plugins — §8). Discharges: `G-C-01`,
`G-B-06`, `A1`, R2.

**C6 — Drift detection must be continuous, because the compiler channel is unavailable.** The plugin
is plain JavaScript; the `no-deprecated` findings that DSH documents as the detector cannot reach it.
The substitute must be a contract-conformance check that asserts each classified surface still has the
expected shape (event names present, service methods present, payload keys present) — because
nothing else will report that upstream moved. Discharges: `G-C-02`, `G-C-08`, `G-C-09`, `G-C-10`, R6.

**C7 — The version gate must be able to gate on *surface shape*, not only on a version range.**
`engines.dsh` is a pre-import gate that can be bypassed by an exact-version exemption, and a range
cannot express "0.2.2-rc.1 works, 0.2.2-rc.3 does not" for a single seam. The design must detect, at
mount time, which variant of each moving surface the running runtime offers — **without** parsing
`process.env` or reading files, since no version service exists. Discharges: `G-C-08`, `G-C-09`,
`G-C-15`.

**C8 — If a session event type owned by another package is used, the plugin must know the owner, must
know whether that package is composed in the running profile, and must not assume the ordering MUST
is unchanged.** `compaction/prune` is declared by `@deepseek-ai/dsh-compaction`, merged in as a
plugin extension, and carries the ordering MUST "the replacement MUST be appended synchronously right
after this event". The plugin currently declares **no** dependency on that package. Discharges:
`G-C-03`, `G-C-14`, `G-B-05`, R5.

### 7.3 Measurement correctness

**C9 — Surface rewrites need a producer discriminator, or an equivalent attribution signal.** The
plugin and the shipped `dsh-compaction-tool-result-pruner` write a **byte-identical** event pair with
no distinguishing field. Until that is resolved, any token-saving number attributed by event shape is
unreliable, and the plugin cannot tell its own tiering from the pruner's pruning. This is a
correctness blocker independent of any architecture. Discharges: `G-B-01`, R1, R5.

**C10 — The session export must carry enough information for its consumer to detect a format change.**
The export is a byte-level copy of DSH's session format, DSH already ships three format migrations,
and the plugin assumes `header.id` is present. A version stamp or a validated envelope is required on
the plugin side. Discharges: `G-C-05`, `G-B-11`, `A12`.

**C11 — Subagent classification must not rest on `origin` alone.** `origin` is explicitly "presentation
metadata, not proof that the child is continuable", and the real mode lives in the log-only
`subagent/descriptor` event. The plugin currently treats `origin === 'subagent'` as ground truth
and treats every other value as root. Discharges: `G-B-02`, `G-B-11`, `G-C-12`, `A11`, R3.

### 7.4 Failure policy

**C12 — Fail loudly vs fail open must be an explicit per-seam policy, not an incidental consequence of
where a `try/catch` happens to sit.** The plugin currently has both, undeclared: some seams fail
loudly (A5 — an unguarded `event.data.turn` throws inside the `session/event` listener) and some fail
open with **no notice at all** (A16 — `if (!meter?.estimateMessage) return` silently disables tiering).
DSH's own convention for a degrading seam is a visible warning; a fail-open must emit exactly one
observable notice **per session**, not per node, so that a silent degradation is distinguishable from a
normal run. Discharges: `G-C-07`, `G-C-10`, `A5`, `A16`, `A18`, `A19`.

**C13 — Unguarded `event.data` reads in the hot event path must be eliminated.** The plugin reads
`event.data.turn`, `event.data.callId`, `event.data.name` and `event.data.arguments` without optional
chaining, while every other read in the same handler uses `?.`. A `TypeError` inside the session-event
listener is thrown into DSH's publication path and is not caught by the plugin. Discharges:
`G-C-10`, `A5`, `A8`, `A9`.

### 7.5 Boundaries of this section

These constraints do **not** specify: the shape of the persisted ledger, the component decomposition,
the transport, the migration strategy, or the order in which the constraints are discharged. Those are
Stage 2's decisions. The constraints also do not license a redesign of the plugin's feature set —
they bound how the existing features may be re-hosted against a moving DSH surface.

## 8. Open questions / UNVERIFIABLE

Everything that could not be established from the installed DSH, the installed plugin, or the live
session-log corpus. These are **not** gaps in the register — they are questions the evidence could not
answer, and Stage 2 must not assume any of them either way.

### 8.1 Aggregated from the three fragments

The verbatim `UNVERIFIABLE` items as recorded by each dimension worker:

- **UNVERIFIABLE — >251-char path collision.** Derived from the source (`slice(0, 251)`); no live
- **UNVERIFIABLE — >251-char path collision.** Derived from the source (`slice(0, 251)`); no live
- **UNVERIFIABLE — `agent.cancel(cause, opts)` argument shape.** No published `.d.ts` declaring `{ kind, reason }` + `{ keepInbox }` was located in `dsh-agent/lib/types/`. A "Durable cancellation cause" type exists in `dsh-session/lib/types/types.d.ts:163`, but it is the *event* cause, not the `agent.cancel` argument.
- **UNVERIFIABLE — macOS/Windows case-insensitive-filesystem collision behaviour.** The host is
- **UNVERIFIABLE — the `SessionSearchRequest` filter shape.** `searchSessions(request: SessionSearchRequest, exec?)` is typed (`dsh-session-query/lib/types/index.d.ts:63`), but the `eventFilters: [{ kind: 'type', values: [...] }]` structure the plugin uses (`index.js:1006`) was not verified against the `SessionSearchRequest` declaration.
- **UNVERIFIABLE — the `tool/result` message's inner call-id location.** The plugin reads `event.data.message.source.callId ?? event.data.message.toolCallId` (`index.js:853`). `tool/result`'s payload type declares `message: ToolResultMessage` (`types.d.ts:382-386`), but I did not read `ToolResultMessage`'s declaration to confirm which call-id field it exposes.
- **UNVERIFIABLE — the engine's actual canonicalization source.** `repokey.js` states it "reproduces
- **UNVERIFIABLE — the exact runtime DSH version as seen by a plugin.** I found no service or context field exposing the runtime version to plugin code. `dsh-app-boot`'s `getDshRuntimeVersion()` (`lib/index.js:1094-1098`) reads its own `package.json` and is **internal to app-boot**. A plugin *can* read `@deepseek-ai/dsh/package.json` via `import.meta.resolve`/fs, but that is not a documented contract. C7.4 must not assume a version service exists.
- **UNVERIFIABLE — where `manifestVersion` is validated.** `grep -rn "manifestVersion"` over `<dsh>` excluding `node_modules` returns **zero** hits; over `<dsh>/node_modules/@deepseek-ai` it hits only `dsh-package-manifest/{src/types.ts,lib/types/types.d.ts,README.md}`. The reader that *consumes* `manifestVersion` (if any) is not in the installed package, or is in a package I did not grep. **I cannot claim the loader validates it, and I cannot claim it does not.**
- **UNVERIFIABLE — whether `engines.node` is enforced.** The loader code located (`dsh-app-boot/lib/index.js:1102-1121`) evaluates `engines.dsh` and DSH peer dependencies only. No node-engine check was found in that path. The plugin declares `">=24.9"` (`package.json:60`) — whether anything enforces it is **not established**.
- **UNVERIFIABLE — whether `surface.nodes` retains shadowed nodes.** The plugin's tiering loop (`index.js:834-843`) depends on shadowed nodes being absent from `session.surface.nodes`. `dsh-session/lib/types/surface.d.ts:55-60` documents the replacement semantics but I did not locate a statement about node retention after a replacement.
- **UNVERIFIABLE — whether the `agent/request` deprecation has a scheduled removal.** No removal date or version appears in the installed upgrade guide. The contract only says "Existing listeners still run" (`docs/upgrade-guide/v0.2.1-alpha.4/session-model-selection/guide.md:16`).
- **UNVERIFIABLE — whether the engine's `repos/` store is even present on this host**, and whether
1. **UNVERIFIABLE — the `origin`/`role` taxonomy beyond `subagent`.** `origin?: 'subagent'` is a single-member union. There is no released `origin` value for "agent-team member", "workflow runner", "fork child", or "background child". The `team/*` events (`team/member`, `team/task`, `team/mode`) and `tool-workflow/*` events exist in the vocabulary but I did not read their payload schemas (budget). Whether DSH has an internal notion of "role" for these is **UNVERIFIABLE** from the files read.
2. **UNVERIFIABLE — parallel/background flags.** No persisted parallel/background bit was found in the session header, the event catalog, or the `subagent/descriptor`/`subagent/catalog` schemas. The only textual occurrence of "background" in the subagent types is a method doc at `dsh-subagent/lib/types/manager.d.ts:85`. I did not read `dsh-tool-subagent` types, so a spawn-time parallel flag there is possible but unverified.
3. **UNVERIFIABLE — whether `Session.append`'s single-event form is intentionally undeclared.** The `.d.ts` declares only the batch form while the runtime has both. I did not find a migration note or a changelog entry explaining the discrepancy (the note referenced by the deprecated reads, `.agents/notes/implemented/architecture/2026-09-09-deprecate-synchronous-session-event-reads.md`, lives in the **source repository**, not in the installed npm package — it is not present under the install tree).
4. **UNVERIFIABLE — `ctx.systemPrompt`, `ctx.tools`, `ctx.tokenMeter` submodule access on `agent.ctx`.** `Agent.ctx` is declared (`runtime-types.d.ts:176`) but the submodule properties are Cordis service properties resolved at runtime; I did not read the `dsh-system-prompt` / `dsh-tools` service-registration types to confirm they are guaranteed present on an **agent-scoped** context (as opposed to the plugin-root context).
5. **UNVERIFIABLE — the `dsh-agent-team` and `dsh-tool-subagent` event payload schemas.** `dsh-agent-team/lib/types/types.d.ts:139` declares a `SessionEventMap` extension; the team event shapes (`team/member`, `team/task`, `team/mode`, `team/message/*`) were not read. 306 `team/task` and 150 `team/member` events exist in the corpus, so this is a materially under-covered part of the event catalog.
6. **UNVERIFIABLE — whether the plugin's writes are ordered correctly relative to `compaction/prune`'s "MUST be appended synchronously right after this event" requirement** under concurrent writers. The plugin appends the pair synchronously inside one call stack (`lib/index.js:872-880`), but the DSH doc does not define what "synchronously right after" means when another writer appends between them. No observed log shows an interleaving, but 2052 prune events make it statistically unlikely to have never occurred — I did not search for interleavings.
7. **UNVERIFIABLE — `dsh-compaction`'s `CompactionResult` and the `dsh-session-format` migration chain** (`v0→v1→v2→v3→v4`). The plugin's appends are v4-native; whether a v3→v4 migration preserves a plugin-written `compaction/prune`/`tool/result` pair was not verified.

### 8.2 Specific items Stage 2 must not assume either way

1. **No `manifestVersion` validator was found.** `grep -rn "manifestVersion"` over the DSH install
   excluding `node_modules` returns **zero** hits; over `node_modules/@deepseek-ai` it hits only
   `dsh-package-manifest/{src/types.ts,lib/types/types.d.ts,README.md}`. The reader that consumes
   `manifestVersion`, if any, is not in the installed package. **We can claim neither that the loader
   validates it nor that it does not.** → `G-C-09`.
2. **Whether `engines.node` is enforced is unknown.** The loader code located
   (`dsh-app-boot/lib/index.js:1102-1121`) evaluates `engines.dsh` and DSH peer dependencies only; no
   node-engine check was found in that path. The plugin declares `">=24.9"` (`package.json:60`).
3. **The `agent/request` removal schedule is undated.** No removal date or version appears in the
   installed upgrade guide; the contract only says "Existing listeners still run". → `G-C-01`, `G-B-06`.
4. **No service exposes the runtime DSH version to a plugin.** `dsh-app-boot`'s
   `getDshRuntimeVersion()` reads its own `package.json` and is **internal to app-boot**. A plugin *can*
   read `@deepseek-ai/dsh/package.json` via `import.meta.resolve`/fs, but that is **not a documented
   contract** — so constraint C7 must not depend on it.
5. **The installed guides top out at `v0.2.2-rc.1` while the runtime is `0.2.2-rc.3`.** The upgrade guide
   is regenerated **at pack time**, so it is a release-time artifact, not a live feed. Either
   `rc.2`/`rc.3` were non-breaking, or the guide lags — **not determinable from the install**. This is
   exactly why the plugin's compatibility watch must read the guide of the version it actually runs
   against. → constraint C6.
6. **The `origin` taxonomy beyond `'subagent'` is unknown.** `origin?: 'subagent'` is a
   single-member union today; no second value was found in the type declarations or in the 350-log
   corpus. → `G-B-02`, `G-C-12`, R3.
7. **The `dsh-agent-team` and `dsh-tool-subagent` payload schemas are uncovered.** Their event names
   appear in the corpus — **306 `team/task` events and 150 `team/member` events** exist — but no
   payload contract was located. A team child's header shape, and therefore its `origin` value, is
   **unknown**, which is exactly the input R3 needs.
8. **`Session.append`'s 3-arg form is undeclared in the types.** The `.d.ts` declares only
   `append(inputs: readonly SessionEventInput[])`; the single-event form exists at runtime and in the
   `index.js` JSDoc (`dsh-session/lib/types/index.d.ts:260-300`) but not in the declaration. Whether
   that is intentional is unknown. → `G-B-05`, `G-C-04`.
9. **Whether `ctx.systemPrompt`, `ctx.tools` and `ctx.tokenMeter` are available on an **agent-scoped**
   `ctx` is unresolved.** The plugin calls `state.agent.ctx.systemPrompt.section(...)`
   (`lib/index.js:663,726`), `state.agent.ctx.tools.restrict({ deny })` (`:739`) and reads
   `ctx.tools.definitions()` from the **plugin-root** ctx (`:719,737`). The root-scoped uses are typed;
   the agent-scoped ones are not established. → `G-C-06`.
10. **The engine's own canonicalization is unverifiable because the engine source is not present.**
    `repokey.js` states it "reproduces" the engine's rule, but the engine is a separate Python package
    whose source was not available to this ingestion. The plugin's repo key can therefore only be
    checked against **its own** declaration, not against the engine's behaviour. → `G-A-14`, `G-A-15`.

## 9. Appendix: source paths read

The union of the three fragments' "Files read" sections. `<dsh>` =
`/home/minami/.local/nodejs/lib/node_modules/@deepseek-ai/dsh`; `<plugin>` =
`/home/minami/Workspace/projects/dsh-workspace/dsh-plugins/dsh-tokeneconomizer`.

### 9.1 Dimension A — project / workspace isolation

#### A.9 Files read

**DSH install** (`/home/minami/.local/nodejs/lib/node_modules/@deepseek-ai/dsh/`):
1. `node_modules/@deepseek-ai/dsh-session-persistence-jsonl/lib/index.js` — L840-960 (projectKey,
   projectDir, sessionDir, generationLogPath, logPath, encodeSegment, isHeaderLine), L3600-3650
   (Config schema).
2. `node_modules/@deepseek-ai/dsh-workspace/lib/index.js` — L100-135, L190-265, L380-450, L636-660,
   L875-905.
3. `node_modules/@deepseek-ai/dsh-workspace/lib/types/paths.js` — full (49 lines).
4. `node_modules/@deepseek-ai/dsh-session/lib/types/index.js` — L45-49, L995-1030.
5. `node_modules/@deepseek-ai/dsh-session-query/lib/index.js` — L700-800.
6. `node_modules/@deepseek-ai/dsh-session-query-sqlite/lib/index.js` — L205-230.
7. `node_modules/@deepseek-ai/dsh-session-projection/lib/index.js` — L129-144.
8. `node_modules/@deepseek-ai/dsh-working-directory/lib/index.js` — L45-57, L117-180.
9. `node_modules/@deepseek-ai/dsh-fs-local/lib/index.js` — L182-210, L820-830.
10. `node_modules/@deepseek-ai/dsh-api-session-controller/lib/index.js` — L99-105, L231-431, L711-731.
11. `node_modules/@deepseek-ai/dsh-schedule/lib/index.js` — L1451-1520 (grep-scoped).
12. `node_modules/@deepseek-ai/dsh-agent-team/lib/types/index.js` — L67 (grep-scoped).
13. `docs/capability-seams.md` — L168-199, L432-485, L575-650, L717-728 (grep-scoped).
14. `docs/config-catalog.md` — L3060-3100 (grep-scoped).
15. `docs/persistence-schema.json` — grep-scoped (`cwd`/`project`/`workspace` keys).
16. `docs/subsystems/persistence.md` — grep-scoped.

**Plugin** (`/home/minami/Workspace/projects/dsh-workspace/dsh-plugins/`):
17. `dsh-tokeneconomizer/lib/repokey.js` — **full (238 lines)**.
18. `dsh-tokeneconomizer/lib/index.js` — L1-40, L535-560, L710-800, L970-1040, L1190-1230, L1314-1324.
19. `dsh-tokeneconomizer/lib/devstats.js` — L1-60 + grep-scoped (`cwd` → 0 hits, `sessionId` → 0 hits).
20. `dsh-tokeneconomizer/lib/devstats-server.js` — L85-175 (`summaryOf`, `pick`, `describe`).
21. `dsh-sidebar-manager/lib/index.js` — L1-60.
22. `dsh-sidebar-manager/lib/groups.mjs` — L70-95.
23. `dsh-tokeneconomizer/docs/OPERATIONS.md` — grep-scoped (`repos/` references).

**Live state (measured, read-only):**
24. `~/.dsh/storages/workspace.json` — 9941 bytes; unit `workspace` v2; 13 workspace ids.
25. `~/.dsh/sessions/` — 9 project dirs; two decompressed session headers.

### 9.2 Dimension B — session & subagent schemas

#### B.11 Files read

**Read in full or by window (12 files):**

| # | File | How |
|---|---|---|
| 1 | `DSH/dsh-session/lib/types/types.d.ts` | windows: 25-154, 255-399, 400-566 (567/568 lines total; read in 3 windows covering ~93%) |
| 2 | `DSH/dsh-session/lib/types/index.d.ts` | windows: 30-129, 130-259, 255-300; grep for member list (546 lines total) |
| 3 | `DSH/dsh-session/lib/types/surface.d.ts` | **full** (187 lines) |
| 4 | `DSH/dsh-session/lib/types/surface.js` | windows: 190-329, 329-388, 380-460 (621 lines total) |
| 5 | `DSH/dsh-session/lib/types/index.js` | windows: 390-420, 615-644, 640-675 |
| 6 | `DSH/dsh-session/lib/types/known-event-types.js` | **full** (90 lines) |
| 7 | `DSH/dsh-session-persistence-jsonl/lib/types/format.d.ts` | lines 1-90 of 200 |
| 8 | `DSH/dsh-agent/lib/types/runtime-types.d.ts` | windows: 160-239, 240-414 (446 lines total) |
| 9 | `DSH/dsh-agent/lib/types/types.d.ts` | lines 1-100 of 111 |
| 10 | `DSH/dsh-tools/lib/types/events.d.ts` | **full** (58 lines) |
| 11 | `DSH/dsh-compaction-tool-result-pruner/lib/index.js` | **full** (194 lines) |
| 12 | `DSH/dsh-compaction/lib/types/types.d.ts` | lines 10-110 |

**Additional files read by narrow window (beyond the 12-file budget, counted separately):**
`DSH/dsh-subagent/lib/types/descriptor.d.ts` (full, 105), `DSH/dsh-subagent/lib/types/catalog.d.ts` (lines 1-60), `DSH/dsh-session-format/lib/types/types.d.ts` (grep only), `DSH/dsh-agent-loop/lib/index.js` (grep only), `DSH/dsh-scope/lib/types/index.d.ts` (lines 1-60), `DSH/dsh-token-meter/lib/types/index.d.ts` + `estimate.d.ts` (grep only), `DSH/dsh-session/lib/types/index.d.ts` session-member list (grep).

**Plugin files:** `/home/minami/Workspace/projects/dsh-workspace/dsh-plugins/dsh-tokeneconomizer/lib/index.js` — **grep only** (never read whole), targeted greps at lines 505-634, 686-698, 771-801, 815-914, 1278-1295; `package.json` (head).

**Data:** 350 `session.v4.jsonl.zstd` logs under `/home/minami/.dsh/sessions/`, decompressed and scanned with `node:zlib` — headers, event-type census, `surfaceOp` payloads, `compaction/prune` pairs.

**Explicitly NOT read:** `persistence-catalog.md` (per instruction), `dsh-agent-team`/`dsh-tool-subagent`/`dsh-agent-preset-registry` type bodies, `dsh-session-format` migration implementations, `dsh-client-ui-*` sources, `dsh-web` sources.

---

*Fragment B — produced against installed DSH `0.2.2-rc.3`. All quotes are verbatim from the files listed in B.11 unless explicitly marked `INFERRED:`.*

### 9.3 Dimension C — upstream drift resilience

#### C.10 Files read

**Files opened for reading — 21 paths** (11 read substantially, 10 opened as narrow windows). Grep-only paths are listed separately and are **not** counted as "read" — they were searched, and only the matching lines are cited.

**Read substantially — 11 files:**

| # | Path | Why |
|---|---|---|
| 1 | `<plugin>/package.json` | declarative assertion surface (71 lines) |
| 2 | `<plugin>/cordis.patch.yml` | the bundle row = the plugin's whole config surface (91 lines) |
| 3 | `<dsh>/docs/capability-seams.md` | lines 1-130, 600-767 (768 lines total) — seam table + graph |
| 4 | `<dsh>/docs/cordis-api/context.md` | lines 228-272 — `ctx.get` / `ctx.set` |
| 5 | `<dsh>/docs/cordis-api/registry.md` | lines 1-40 — `ctx.inject` / `ctx.plugin` |
| 6 | `<dsh>/node_modules/@deepseek-ai/dsh-app-boot/lib/index.js` | lines 1070-1169 — `evaluatePluginCompatibility`, `unmetRequirements`, `pluginCompatibilityWarning` |
| 7 | `<dsh>/node_modules/@deepseek-ai/dsh-package-manifest/README.md` | lines 1-90 — the manifest field contract |
| 8 | `<dsh>/node_modules/@deepseek-ai/dsh-session/lib/types/types.d.ts` | lines 66-90, 261-400, 442-530 — `SessionHeader`, `SessionEventMap`, `SurfaceOp` |
| 9 | `<dsh>/node_modules/@deepseek-ai/dsh-session/lib/types/index.d.ts` | lines 55-75, 250-300 — `session/event`, `append` overloads |
| 10 | `<dsh>/node_modules/@deepseek-ai/dsh-system-prompt/lib/types/index.d.ts` | lines 1-60, `section`/`context` signatures |
| 11 | `<dsh>/node_modules/@deepseek-ai/dsh-session/lib/types/surface.d.ts` | lines 55-90 — `surfaceOp` variants |

**Opened as narrow windows (grep + offset) — 10 further files:**

| # | Path | Windows |
|---|---|---|
| 12 | `<plugin>/lib/index.js` (1396 lines / 58 KB — **never read whole**) | 415-514, 527-562, 615-729, 744-752, 765-884, 895-960, 960-1029, 1275-1354, plus `grep -n` over the whole file for `ctx.get(`, `ctx.inject`, `event.type ===`, `event.data`, `session.header.`, `agent.`, `\.on('` |
| 13 | `<plugin>/lib/bridge.js` | 210-250 |
| 14 | `<plugin>/lib/client.js` | 635-660 |
| 15 | `<dsh>/node_modules/@deepseek-ai/dsh-agent/lib/types/runtime-types.d.ts` | 250-275, 355-375, 400-405 |
| 16 | `<dsh>/node_modules/@deepseek-ai/dsh-tools/lib/types/events.d.ts` | 40-50 |
| 17 | `<dsh>/node_modules/@deepseek-ai/dsh-tools/lib/types/index.d.ts` | 50-105 (`restrict`, `definitions`) |
| 18 | `<dsh>/node_modules/@deepseek-ai/dsh-token-meter/lib/types/index.d.ts` | 20-70 (`estimateMessage`) |
| 19 | `<dsh>/node_modules/@deepseek-ai/dsh-token-meter/lib/types/projection.d.ts` | 60-75 (projection keys) |
| 20 | `<dsh>/node_modules/@deepseek-ai/dsh-compaction/src/types.ts` | 76-96 (`compaction/prune`) |
| 21 | `<dsh>/docs/upgrade-guide/README.md` | 1-70 (all section headers + v0.2.2-rc.1 / alpha.3 / alpha.2 rows) |

**Grep-only (no file read) — cited as grep results:** `<dsh>/docs/upgrade-guide/v0.2.1-alpha.4/session-model-selection/guide.md`, `.../v0.2.2-alpha.2/projection-snapshot-scope/guide.md`, `.../v0.2.2-rc.1/session-append-overloads/guide.md`, `.../v0.2.1-rc.2/session-projection-handles/guide.md`, `.../v0.2.1-rc.2/tool-executor-plugins/guide.md`, `<dsh>/docs/architecture.md`, `<dsh>/docs/subsystems/session.md`, `<dsh>/docs/subsystems/session-projection.md`, `<dsh>/docs/config-catalog.md`, `<dsh>/node_modules/@deepseek-ai/dsh-session-query/lib/types/index.d.ts`, `<dsh>/node_modules/@deepseek-ai/dsh-agent/lib/types/types.d.ts`, `<dsh>/node_modules/@deepseek-ai/dsh-agent/lib/types/index.d.ts`, `<dsh>/node_modules/@deepseek-ai/dsh-session-projection/`, `<dsh>/src/`, `<dsh>/lib/types/`, `<dsh>/node_modules/@deepseek-ai/*/lib/types/` (package inventory).


### 9.4 Not read

The negative evidence. No claim in this brief depends on any of the following.

| Path / artefact | Why not |
|---|---|
| `<plugin>/lib/index.js` **in full** (1396 lines / 58 KB) | Read only as narrow windows (415-514, 527-562, 615-729, 744-752, 765-884, 895-960, 960-1029, 1275-1354) plus targeted `grep -n` passes. Plugin intent is inferred from call sites, not from comments alone. |
| The TokenEconomizer **Python engine source** | Not present on this host. Its canonicalisation rule cannot be checked — only the plugin's declaration of it. |
| `<dsh>/src/` and `<dsh>/lib/types/` | Grepped, not read. Cited in this brief only as grep results. |
| `dsh-agent-team` / `dsh-tool-subagent` **payload schemas** | Event names observed in the corpus (306 `team/task`, 150 `team/member`) but no payload contract located. |
| The **full** 354-log session corpus | 350 logs decompressed for header + event-type ground truth. Every event payload of every log was not parsed; the 4 most recent logs were outside the sample. |
| `dsh-session-format-v0-to-v1` / `v1-to-v2` / `v2-to-v3` **source** | Presence measured (package dirs exist); their migration semantics were not read. |
| The `v0.2.2-rc.2` / `v0.2.2-rc.3` **upgrade-guide sections** | Not installed. The guide tops out at `v0.2.2-rc.1` while the runtime is `0.2.2-rc.3`. |
| The DSH **runtime version service** | None exists that a plugin can consume; `getDshRuntimeVersion()` is internal to `dsh-app-boot`. |

### 9.5 Provenance — fragment range to section

| Brief section | Source | Range in the fragment |
|---|---|---|
| §3.1 Project / workspace identity | Fragment A | lines 5-208 (A.1-A.3) |
| §3.2 Session header schema | Fragment B | lines 12-177 (B.1-B.2) |
| §3.3 Session event catalog | Fragment B | lines 302-348 (B.4) |
| §3.4 Subagent / delegation schema | Fragment B | lines 119-301 (B.2-B.3) |
| §3.5 surfaceOp append contract | Fragment B | lines 349-697 (B.5) — verbatim |
| §3.6 Lifecycle hook signatures | Fragment B | lines 698-906 (B.6) |
| §3.7 Public vs internal surface | Fragment B | lines 907-978 (B.7) |
| §3.8 Services the plugin may consume | Fragment A | lines 209-228 (A.4) |
| §3.9 Seam stability tiers | Fragment C | lines 21-160 (C.1-C.4) |
| §4.1 The engine repo key | Fragment A | lines 229-284 (A.5) |
| §4.2 Drift-defense constraints | Fragment C | lines 251-281 (C.7) |
| §5 GAP REGISTER | All three | A:402-416 · B:1081-1092 · C:286-300 |
| §5.1 Summary counts | Derived | recomputed from the 42 collected rows |
| §6 Hard-assumption inventory | Fragment C | lines 165-199 (A1-A33 table) |
| §8.1 UNVERIFIABLE | All three | every line matching `UNVERIFIABLE` |
| §9.1-9.3 Files read | All three | A:438-472 · B:1111-1141 · C:315-351 |

Fragment headings are preserved (demoted so they nest under this document's headings): fragment A and C
headings shift by one level, fragment B by two, because fragment B's own top level is `##` while A's and
C's are `###`/`##` respectively.
