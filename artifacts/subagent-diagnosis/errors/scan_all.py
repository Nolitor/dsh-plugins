#!/usr/bin/env python3
"""Scan ALL ~/.dsh/sessions zstd logs for opencode backend failures + model drops.
Read-only on ~/.dsh. Output: sessions.json + matches.jsonl in this dir."""
import json, os, subprocess, collections, re, sys

SESS = os.path.expanduser('~/.dsh/sessions')
OUT = os.path.dirname(os.path.abspath(__file__))

# patterns that matter (applied to each raw event JSON string)
PATTERNS = {
    'OPENCODE_BACKEND_HTTP': re.compile(r'OPENCODE_BACKEND_HTTP'),
    'HTTP_451': re.compile(r'HTTP 451|status[^0-9]{0,6}451'),
    'ENDPOINT_UNAVAILABLE': re.compile(r'Endpoint is unavailable'),
    'HY4': re.compile(r'hy4', re.I),
    'STEP5': re.compile(r'step-5-preview'),
    'LLM_RETRY': re.compile(r'llm/retry|"retry"|Retrying', re.I),
    'HTTP_5XX': re.compile(r'HTTP 5\d\d|status[^0-9]{0,6}5\d\d\b'),
    'PROVIDER_ERROR': re.compile(r'provider[_-]error|upstream_error|server_error', re.I),
    'RATE_LIMIT': re.compile(r'429|rate.?limit', re.I),
}

def decompress(path):
    p = subprocess.run(['zstd', '-d', '-c', path], capture_output=True)
    return p.stdout

def model_of(evs):
    for e in evs:
        if e.get('type') == 'subagent/descriptor':
            d = e.get('data', {})
            return d.get('agentProvider'), d.get('agentModel')
    for e in evs:
        if e.get('type') == 'request/header':
            h = e.get('data', {}).get('header', {}).get('config', {})
            if h.get('provider'):
                return h.get('provider'), h.get('model')
    for e in evs:
        if e.get('type') == 'request/context':
            d = e.get('data', {})
            return d.get('provider'), d.get('model')
    return None, None

def err_of_result(d):
    msg = d.get('message', {}) or {}
    err = d.get('error') or msg.get('error')
    iserr = bool(err) or bool(msg.get('isError')) or bool(d.get('isError'))
    return err if err else ({'name': 'TEXT_IS_ERROR'} if iserr else None)

def text_of(obj, limit=400):
    parts = []
    msg = obj.get('message', {}) if isinstance(obj, dict) else {}
    for c in (msg.get('content') or []):
        if isinstance(c, dict) and c.get('type') == 'text':
            parts.append(c.get('text', ''))
    return ' '.join(parts)[:limit]

def scan_file(proj, path):
    raw = decompress(path)
    lines = [l for l in raw.decode('utf-8', 'replace').splitlines() if l.strip()]
    evs = []
    for l in lines:
        try:
            evs.append(json.loads(l))
        except Exception:
            pass
    if not evs:
        return None, []
    hdr = evs[0] if evs[0].get('type') == 'session' else {}
    sid = hdr.get('id') or os.path.basename(os.path.dirname(path))
    provider, model = model_of(evs)
    desc = next((e.get('data', {}) for e in evs if e.get('type') == 'subagent/descriptor'), {})
    tool_calls = 0
    tool_errors = collections.Counter()
    turn_errors = []
    attempt_errors = []
    last_time = 0
    created = hdr.get('createdAt') or (evs[0].get('time') if evs else 0)
    matches = []
    retry_events = 0
    for e in evs:
        t = e.get('type')
        tm = e.get('time') or 0
        if tm > last_time:
            last_time = tm
        if t == 'tool/call':
            tool_calls += 1
        elif t == 'tool/result':
            er = err_of_result(e.get('data', {}))
            if er:
                tool_errors[(er.get('name'), er.get('code'))] += 1
        elif t == 'turn/end':
            reason = e.get('data', {}).get('reason') or {}
            if reason.get('kind') == 'error' or reason.get('error'):
                turn_errors.append(reason.get('error') or reason)
        elif t == 'assistant/attempt':
            d = e.get('data', {})
            for ch in d.get('stream', []):
                ch = ch.get('chunk', {})
                if ch.get('type') == 'finish' and ch.get('reason', {}).get('kind') == 'error':
                    attempt_errors.append(ch['reason'].get('failure') or ch['reason'])
        if t in ('llm/retry', 'provider/retry', 'retry') or 'retry' in str(t):
            retry_events += 1
        s = json.dumps(e, ensure_ascii=False)
        for name, pat in PATTERNS.items():
            if pat.search(s):
                matches.append({'pattern': name, 'sid': sid, 'proj': proj,
                                'type': t, 'seq': e.get('seq'), 'time': tm,
                                'provider': provider, 'model': model,
                                'snippet': s[:500]})
    rec = {
        'sid': sid, 'proj': proj, 'createdAt': created, 'lastTime': last_time,
        'parentSession': hdr.get('parentSession'), 'agentPreset': hdr.get('agentPreset'),
        'origin': hdr.get('origin'), 'descriptorProvider': desc.get('agentProvider'),
        'descriptorModel': desc.get('agentModel'), 'provider': provider, 'model': model,
        'events': len(evs), 'toolCalls': tool_calls,
        'toolErrors': dict((f'{k[0]}/{k[1]}', v) for k, v in tool_errors.items()),
        'toolErrorTotal': sum(tool_errors.values()),
        'turnErrors': turn_errors, 'attemptErrors': attempt_errors,
        'retryEvents': retry_events,
        'turnStarts': sum(1 for e in evs if e.get('type') == 'turn/start'),
        'turnEnds': sum(1 for e in evs if e.get('type') == 'turn/end'),
    }
    return rec, matches

def main():
    recs, allm = [], []
    dirs = []
    for proj in sorted(os.listdir(SESS)):
        pd = os.path.join(SESS, proj)
        if not os.path.isdir(pd):
            continue
        for sub in sorted(os.listdir(pd)):
            p = os.path.join(pd, sub, 'session.v4.jsonl.zstd')
            if os.path.exists(p):
                dirs.append((proj, p))
    print('files:', len(dirs), file=sys.stderr)
    for i, (proj, p) in enumerate(dirs):
        try:
            rec, m = scan_file(proj, p)
        except Exception as ex:
            print('FAIL', p, ex, file=sys.stderr)
            continue
        if rec:
            recs.append(rec)
            allm.extend(m)
        if (i + 1) % 20 == 0:
            print('scanned', i + 1, file=sys.stderr)
    recs.sort(key=lambda r: r['createdAt'] or 0)
    json.dump(recs, open(os.path.join(OUT, 'sessions.json'), 'w'), ensure_ascii=False, indent=1)
    with open(os.path.join(OUT, 'matches.jsonl'), 'w') as f:
        for m in allm:
            f.write(json.dumps(m, ensure_ascii=False) + '\n')
    print('sessions:', len(recs), 'matches:', len(allm))
    print('pattern counts:', collections.Counter(m['pattern'] for m in allm))

if __name__ == '__main__':
    main()
