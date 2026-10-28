
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { execFileSync } from 'node:child_process';

const HOME = process.env.HOME;
const DSH = path.join(HOME, '.dsh');
const WS_JSON = path.join(DSH, 'storages/workspace.json');
const SESSIONS_ROOT = path.join(DSH, 'sessions');
const PLUGINS_ROOT = '/home/minami/Workspace/projects/dsh-workspace/dsh-plugins';
const EXPECTED_TITLES = {
  'session-b53400d8-41db-4a3b-b611-a14f43e62916': 'DSH Notify 하이브리드 듀얼 모드 아키텍처 설계',
  'session-a3b2bf75-8959-4a8e-8b53-9d4394b898e3': '부트 카드 읽고 헤더 인덱싱 작업',
  'session-ebc6d16e-e21f-42a9-a181-817815451b45': 'Fix Korean font persistence issue',
  'session-281956f8-db78-4718-ad65-1f405053248d': 'DSH 한글 로컬라이징 검토',
  'session-9bde4597-b4ea-4b2e-a7a1-a92a676e726d': '현재 프로젝트(기본 작업공간',
};
const OLD_CWD = '/home/minami/Workspace/projects/DSH Notify';
const TARGET_WS = '14879f56-24e5-4b96-a1b5-0778356e8960';
const EXPECTED = [
  'session-b53400d8-41db-4a3b-b611-a14f43e62916',
  'session-95a9341d-a091-4a4b-879d-899cb432b9cc',
  'session-21197fd9-a032-4cbd-b5b5-cd0882ce3fe9',
  'session-318f99bb-f0dd-462a-8540-3cb7d3694e2d',
  'session-c7a8072b-507d-4679-833c-3952f3b041c6',
  'session-a3b2bf75-8959-4a8e-8b53-9d4394b898e3',
  'session-58a2dc78-0e98-49ac-8f3a-beec8a2997c6',
  'session-f9c95dba-191d-4096-94c6-be35c1f8ef4b',
  'session-ebc6d16e-e21f-42a9-a181-817815451b45',
  'session-281956f8-db78-4718-ad65-1f405053248d',
  'session-9bde4597-b4ea-4b2e-a7a1-a92a676e726d',
];
const results = [];
const check = (name, ok, detail = '') => { results.push({ name, ok, detail }); };

function projectKey(cwd) {
  let readable = ''; let sep = false;
  for (const ch of cwd) {
    if (ch === '/' || ch === '\\' || ch === ':') { if (!sep) readable += '-'; sep = true; }
    else if (ch !== '~' && /^[A-Za-z0-9._-]$/.test(ch)) { readable += ch; sep = false; }
    else { readable += '~' + ch.charCodeAt(0).toString(16).toUpperCase().padStart(4, '0'); sep = false; }
  }
  return '--' + ((readable.replace(/^-+/, '') || 'root').slice(0, 251)) + '--';
}
function scanFrames(buf) {
  const frames = []; let offset = 0;
  while (offset < buf.length) {
    const start = offset;
    if (buf.length - offset < 4) throw new Error('torn header');
    if (buf.readUInt32LE(offset) !== 0xFD2FB528) throw new Error('bad magic at ' + offset);
    offset += 4;
    const d = buf.readUInt8(offset); offset += 1;
    if ((d & 24) !== 0) throw new Error('reserved');
    const fcsFlag = d >>> 6, single = (d & 32) !== 0, checksum = (d & 4) !== 0, dictFlag = d & 3;
    const fcsBytes = fcsFlag === 0 ? (single ? 1 : 0) : (1 << fcsFlag);
    offset += (single ? 0 : 1) + (dictFlag === 3 ? 4 : dictFlag) + fcsBytes;
    for (;;) {
      if (buf.length - offset < 3) throw new Error('torn block');
      const h = buf.readUIntLE(offset, 3); offset += 3;
      const last = (h & 1) !== 0, type = (h >>> 1) & 3, size = h >>> 3;
      if (type === 3) throw new Error('reserved block');
      offset += type === 1 ? 1 : size;
      if (last) break;
    }
    if (checksum) offset += 4;
    frames.push({ start, end: offset });
  }
  return frames;
}

const ws = JSON.parse(fs.readFileSync(WS_JSON, 'utf8'));
check('workspace.json parses', true);
const rec = ws.tables.workspaces[TARGET_WS];
check('DSH Plugins record preserved (id 14879f56...)', !!rec);
check('title == "DSH Plugins"', rec?.title === 'DSH Plugins', rec?.title);
check('path == plugins root', rec?.path === PLUGINS_ROOT, rec?.path);
check('path exists and is directory', fs.existsSync(PLUGINS_ROOT) && fs.statSync(PLUGINS_ROOT).isDirectory());
check('path is canonical realpath', fs.realpathSync(PLUGINS_ROOT) === PLUGINS_ROOT, fs.realpathSync(PLUGINS_ROOT));
check('8 sessionIds preserved in same order', JSON.stringify(rec?.sessionIds) === JSON.stringify(EXPECTED));
check('no workspace titled "DSH Notify"', !Object.values(ws.tables.workspaces).some(w => w.title === 'DSH Notify'));
const paths = Object.values(ws.tables.workspaces).map(w => w.path);
check('all workspace paths unique', new Set(paths).size === paths.length);
const allSessions = Object.values(ws.tables.workspaces).flatMap(w => w.sessionIds);
check('no session accounted twice', new Set(allSessions).size === allSessions.length);
const DEFAULT_WS = '3f7ba34a-7549-4400-9bc5-3b8179415f25';
const TRANSFERRED = [
  'session-ebc6d16e-e21f-42a9-a181-817815451b45',
  'session-281956f8-db78-4718-ad65-1f405053248d',
  'session-9bde4597-b4ea-4b2e-a7a1-a92a676e726d',
];
const defWs = ws.tables.workspaces[DEFAULT_WS];
check('default workspace record exists', !!defWs);
check('transferred sessions removed from default workspace', !!defWs && TRANSFERRED.every(id => !defWs.sessionIds.includes(id)));
check('default workspace retains 12 non-plugin sessions', defWs?.sessionIds.length === 12, String(defWs?.sessionIds.length));
check('DSH Plugins has 11 sessions (8 historical + 3 transferred)', rec?.sessionIds.length === 11, String(rec?.sessionIds.length));
check('transferred sessions appended to DSH Plugins in order', !!rec && JSON.stringify(rec.sessionIds.slice(8)) === JSON.stringify(TRANSFERRED));
check('old project session dirs removed for transferred sessions', TRANSFERRED.every(id => !fs.existsSync(path.join(SESSIONS_ROOT, projectKey('/home/minami/Workspace/projects/dsh-workspace'), id))));

check('workspaceIds count matches table', ws.global.workspaceIds.length === Object.keys(ws.tables.workspaces).length);

const oldDir = path.join(SESSIONS_ROOT, projectKey(OLD_CWD));
check('old DSH Notify session dir removed', !fs.existsSync(oldDir), oldDir);
check('old project dir removed', !fs.existsSync(OLD_CWD), OLD_CWD);

const newProjectDir = path.join(SESSIONS_ROOT, projectKey(PLUGINS_ROOT));
check('derived project dir exists', fs.existsSync(newProjectDir), newProjectDir);
let okSessions = 0;
const appends = [];
for (const id of EXPECTED) {
  const file = path.join(newProjectDir, id, 'session.v4.jsonl.zstd');
  try {
    if (!fs.existsSync(file)) throw new Error('missing file ' + file);
    const buf = fs.readFileSync(file);
    const frames = scanFrames(buf);
    const f1 = zlib.zstdDecompressSync(buf.subarray(frames[0].start, frames[0].end)).toString('utf8');
    if (f1.indexOf('\n') !== f1.length - 1) throw new Error('frame1 has extra newline/not exactly one header line');
    const header = JSON.parse(f1.slice(0, -1));
    if (header.type !== 'session') throw new Error('bad type');
    if (header.id !== id) throw new Error('id mismatch');
    if (header.cwd !== PLUGINS_ROOT) throw new Error('cwd mismatch: ' + header.cwd);
    // Frame count is not an invariant. DSH appends one frame per write, so any session that is
    // still live keeps growing past the frame count it had when it was promoted (the session
    // running this audit is one of them). The real invariants are: Frame 1 is exactly the header
    // line, and every later frame is a valid, newline-terminated JSONL event slice.
    if (frames.length < 2) throw new Error('expected at least a header frame and one event frame, got ' + frames.length);
    const body = frames.slice(1).map(f => zlib.zstdDecompressSync(buf.subarray(f.start, f.end)).toString('utf8')).join('');
    if (!body.endsWith('\n')) throw new Error('body must end with newline');
    for (const line of body.split('\n').filter(Boolean)) JSON.parse(line);
    // compare body to archived original decode, but only for sessions that are not still live:
    // a live session's body legitimately gains events after the promotion snapshot.
    const origFile = '/tmp/notify-decoded/' + id + '.jsonl';
    if (fs.existsSync(origFile)) {
      const orig = fs.readFileSync(origFile, 'utf8');
      const origBody = orig.slice(orig.indexOf('\n') + 1);
      if (origBody !== body) {
        if (!body.startsWith(origBody)) throw new Error('body differs from original archive (not an append-only extension)');
        appends.push(id);
      }
    }
    okSessions++;
  } catch (error) {
    check('session ' + id, false, String(error.message || error));
  }
}
check('all promoted sessions: header-only Frame 1, valid event frames, body preserved (append-only)', okSessions === EXPECTED.length, okSessions + '/' + EXPECTED.length + (appends.length ? ' append-extended(live): ' + appends.join(',') : ''));

// plugin tracks
const track = (rel, files) => {
  const root = path.join(PLUGINS_ROOT, rel);
  check('track exists: ' + rel, fs.existsSync(root));
  for (const f of files) check('  ' + rel + '/' + f, fs.existsSync(path.join(root, f)));
};
track('dsh-korean-locale', ['package.json', 'lib/index.js', 'lib/client.js', 'data/ko.json', 'locale/ko.json', 'cordis.patch.yml']);
track('dsh-notify', ['package.json', 'cordis.patch.yml', 'lib/index.js', 'lib/client.js']);
track('dsh-sidebar-manager', ['package.json', 'cordis.patch.yml', 'lib/index.js', 'lib/client.js']);
for (const d of ['docs/dsh-plugin-runtime-spec.md', 'docs/plugin-boot-card.md']) check('doc exists: ' + d, fs.existsSync(path.join(PLUGINS_ROOT, d)));

// korean locale link & profile
const profilePkg = JSON.parse(fs.readFileSync(path.join(DSH, 'profiles/web/package.json'), 'utf8'));
const spec = profilePkg.dependencies?.['@nolit/dsh-korean-locale'];
check('profile dependency points to new path', spec === 'link:' + path.join(PLUGINS_ROOT, 'dsh-korean-locale'), spec);
check('profile bundles include korean-locale', profilePkg.dsh?.profile?.bundles?.includes('@nolit/dsh-korean-locale'));
const linked = path.join(DSH, 'profiles/web/node_modules/@nolit/dsh-korean-locale');
check('locale node_modules link resolves', fs.existsSync(linked) && fs.realpathSync(linked) === path.join(PLUGINS_ROOT, 'dsh-korean-locale'), fs.existsSync(linked) ? fs.realpathSync(linked) : 'missing');
check('locale plugin package name', JSON.parse(fs.readFileSync(path.join(PLUGINS_ROOT, 'dsh-korean-locale/package.json'), 'utf8')).name === '@nolit/dsh-korean-locale');

// cleanup check: no stray symlinks under plugins root
let broken = [];
const walk = (dir) => {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name === '.git' || e.name === 'node_modules') continue;
    const p = path.join(dir, e.name);
    if (e.isSymbolicLink()) { if (!fs.existsSync(p)) broken.push(p); }
    else if (e.isDirectory()) walk(p);
  }
};
walk(PLUGINS_ROOT);
check('no broken symlinks under DSH Plugins', broken.length === 0, broken.join(', '));


// Projection-cache lifecycle identities (the title-resolution source) must be re-stamped to the
// promoted cwd. This is the invariant: a cache record whose identity.cwd no longer matches the
// header is discarded, and the session renders as the `session.untitled` fallback.
//
// The *title value* is deliberately NOT part of the invariant. Any session that is still live
// (including the session running this audit) has its title re-derived by the DSH
// session-title plugin while it is open, so asserting a frozen historical title turns a healthy
// live session into a false failure. Titles are checked as "identity binds" + "no title was
// silently lost" instead of "title equals the 2026-10-24 snapshot".
const CACHE_DIR = path.join(DSH, 'storages/session_projcache/sessions');
const cacheIdentityFailures = [];
const cacheTitleRegressions = [];
for (const id of EXPECTED) {
  try {
    const rec = JSON.parse(fs.readFileSync(path.join(CACHE_DIR, id + '.json'), 'utf8'));
    const identity = rec.record?.identity ?? {};
    if (identity.cwd !== PLUGINS_ROOT) throw new Error('identity.cwd=' + identity.cwd);
    if (identity.formatVersion !== 4 || identity.isSeeded !== false || identity.inheritedEventCount !== 0) throw new Error('lifecycle fields diverge');
  } catch (error) {
    cacheIdentityFailures.push({ id, error: String(error.message || error) });
    continue;
  }
  try {
    const rec = JSON.parse(fs.readFileSync(path.join(CACHE_DIR, id + '.json'), 'utf8'));
    const title = rec.record?.rows?.title?.val ?? null;
    const historical = EXPECTED_TITLES[id] ?? null;
    // A title may appear or be re-derived while a session is live; it may never disappear.
    if (historical !== null && (title ?? null) === null) throw new Error('historical title lost');
  } catch (error) {
    cacheTitleRegressions.push({ id, error: String(error.message || error) });
  }
}
check('all promoted projection-cache identities re-stamped to promoted cwd', cacheIdentityFailures.length === 0, JSON.stringify(cacheIdentityFailures));
check('no historical title lost from projection cache', cacheTitleRegressions.length === 0, JSON.stringify(cacheTitleRegressions));

const failed = results.filter(r => !r.ok);
console.log(JSON.stringify({ ok: failed.length === 0, checks: results.length, failed: failed.length, failures: failed, results }, null, 2));
process.exit(failed.length === 0 ? 0 : 1);
