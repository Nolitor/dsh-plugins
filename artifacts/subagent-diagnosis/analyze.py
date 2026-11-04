import json, os, subprocess, sys, collections

BASE = '/home/minami/.dsh/sessions/--home-minami-Workspace-projects-dsh-workspace-dsh-plugins--'
PARENT = 'session-e42cf5d8-b927-42fc-814b-6b30a38f9983'

def load(path):
    raw = subprocess.run(['zstd', '-d', '-c', path], capture_output=True).stdout
    return [json.loads(l) for l in raw.decode('utf-8', 'replace').splitlines() if l.strip()]

def err_text(res):
    msg = res.get('message', {})
    content = msg.get('content', [])
    out = []
    for c in content:
        if c.get('type') == 'text':
            out.append(c.get('text', ''))
    return '\n'.join(out)

def analyze(sid, events):
    hdr = events[0]
    desc = next((e['data'] for e in events if e.get('type') == 'subagent/descriptor'), {})
    turns = [e for e in events if e.get('type') == 'turn/end']
    calls = {}
    errs = []
    tool_counts = collections.Counter()
    for e in events:
        if e.get('type') == 'tool/call':
            d = e['data']; calls[d.get('callId')] = d
            tool_counts[d.get('name')] += 1
    for e in events:
        if e.get('type') == 'tool/result':
            d = e['data']; msg = d.get('message', {})
            src = msg.get('source', {})
            cid = src.get('callId')
            name = calls.get(cid, {}).get('name', '?')
            if d.get('error') or msg.get('isError') or d.get('isError'):
                errs.append((name, (d.get('error') or {}), err_text(d)[:600]))
    print('=' * 80)
    print('CHILD', sid, 'label=', desc.get('label'))
    print('  agent:', desc.get('agentProvider'), desc.get('agentModel'), 'mode', desc.get('mode'))
    print('  created', hdr.get('createdAt'), 'events', len(events), 'toolcalls', sum(tool_counts.values()), dict(tool_counts))
    print('  turn/end reasons:', [json.dumps(t.get('data', {}).get('reason'), ensure_ascii=False)[:500] for t in turns])
    print('  tool errors:', len(errs))
    for n, e, t in errs:
        print('   -', n, json.dumps(e, ensure_ascii=False)[:200], '|', t.replace('\n', ' ')[:300])
    return dict(sid=sid, label=desc.get('label'), provider=desc.get('agentProvider'), model=desc.get('agentModel'),
                tools=sum(tool_counts.values()), errors=len(errs), tool_counts=dict(tool_counts),
                end=[t.get('data', {}).get('reason') for t in turns])

def main():
    out = []
    for d in sorted(os.listdir(BASE)):
        p = os.path.join(BASE, d, 'session.v4.jsonl.zstd')
        if not os.path.exists(p):
            continue
        ev = load(p)
        hdr = ev[0]
        if hdr.get('parentSession') == PARENT:
            out.append(analyze(d, ev))
    print('=' * 80)
    print('SUMMARY')
    for r in out:
        print(json.dumps({k: r[k] for k in ('sid', 'label', 'provider', 'model', 'tools', 'errors')}, ensure_ascii=False))
    json.dump(out, open('/home/minami/Workspace/projects/dsh-workspace/dsh-plugins/artifacts/subagent-diagnosis/children.json', 'w'), ensure_ascii=False, indent=1, default=str)

if __name__ == '__main__':
    main()
