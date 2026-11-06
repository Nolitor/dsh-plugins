#!/usr/bin/env bash
# Install the host-wide shared docs directory and the agent pointer blocks.
# Idempotent. Refuses to run if the target filesystem is read-only.
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
WS="/home/minami/Workspace/projects"
SHARED="$WS/docs"

# ---- 0. preflight: the parent of the project tree must be writable ----------
if ! touch "$WS/.shared-docs-probe" 2>/dev/null; then
  echo "ABORT: $WS is not writable (root fs mounted read-only)." >&2
  echo "       Remount rw first, then re-run:" >&2
  echo "         sudo mount -o remount,rw /" >&2
  exit 1
fi
rm -f "$WS/.shared-docs-probe"

# ---- 1. the shared docs tree ------------------------------------------------
echo "==> $SHARED"
mkdir -p "$SHARED"
cp "$HERE/docs/README.md"              "$SHARED/README.md"
cp "$HERE/docs/HOST-BROWSER-POLICY.md" "$SHARED/HOST-BROWSER-POLICY.md"

# ---- 2. DSH pointer: extend the existing managed block, never duplicate ------
DSH_AGENTS="/home/minami/.dsh/AGENTS.md"
if [ -f "$DSH_AGENTS" ] && ! grep -q 'shared-docs pointer (managed)' "$DSH_AGENTS"; then
  echo "==> extending the existing lightpanda managed block in $DSH_AGENTS"
  python3 - "$DSH_AGENTS" <<'PY'
import sys, pathlib
p = pathlib.Path(sys.argv[1])
t = p.read_text()
marker = "- 전체 규칙: /home/minami/.local/share/lpd/AGENTS_GUIDE.md"
add = (marker + "\n"
       "- 호스트 공용 문서: `/home/minami/Workspace/projects/docs/` — 브라우저 정책 전문은\n"
       "  `/home/minami/Workspace/projects/docs/HOST-BROWSER-POLICY.md`\n"
       "<!-- >>> shared-docs pointer (managed) >>> -->\n"
       "**호스트 공용 문서 (필수)**: 모든 프로젝트에 적용되는 규칙은 `/home/minami/Workspace/projects/docs/`에 있다.\n"
       "<!-- <<< shared-docs pointer (managed) <<< -->")
if marker in t and add.split('\n')[0] == marker:
    t = t.replace(marker, add, 1)
    p.write_text(t)
    print("    extended")
else:
    print("    WARNING: managed marker not found; left untouched", file=sys.stderr)
PY
else
  echo "==> $DSH_AGENTS already carries the pointer (or is absent) — skipped"
fi

# ---- 3. OpenCode: it is a SYMLINK to the SSOT; do not clobber it ------------
OC_AGENTS="/home/minami/.config/opencode/AGENTS.md"
if [ -L "$OC_AGENTS" ]; then
  echo "==> $OC_AGENTS is a symlink -> $(readlink "$OC_AGENTS")"
  echo "    NOT replacing it (that would break its original purpose)."
  echo "    To let OpenCode see the host docs, append the pointer to the SSOT itself:"
  echo "      $(readlink "$OC_AGENTS")"
elif [ -f "$OC_AGENTS" ] && ! grep -q 'shared-docs pointer (managed)' "$OC_AGENTS"; then
  cat "$HERE/agents/AGENTS.shared-docs.md" >> "$OC_AGENTS"
  echo "==> appended pointer to $OC_AGENTS"
else
  echo "==> $OC_AGENTS — nothing to do"
fi

# ---- 4. agents with no rules file: report, do not invent one ----------------
for d in /home/minami/.antigravity /home/minami/.hermes /home/minami/.claude /home/minami/.codex; do
  if [ -d "$d" ] && [ ! -f "$d/AGENTS.md" ]; then
    echo "MANUAL: $d exists but has no AGENTS.md — add the pointer block if that CLI reads one."
  fi
done

echo
echo "DONE. Shared docs at $SHARED"
ls -la "$SHARED"
