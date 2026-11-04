#!/usr/bin/env python3
"""Focused failure/retry scan: attributes each failure to the model active at that time.
Read-only on ~/.dsh. Output: failures.jsonl, retries.jsonl, toolerrs.json, perfail.json"""
import json, os, subprocess, collections, sys, re

SESS = os.path.expanduser('~/.dsh/sessions')
OUT = os.path.dirname(os.path.abspath(__file__))

def load(path):
    p = subprocess.run(['zstd', '-d', '-c', path], capture_output=True)
    return [json.loads(l) for l in p.stdout.decode('utf-8', 'replace').splitlines() if l.strip()]

def text_of(msg, limit=500):
    if not isinstance(msg, dict): return ''
    out = []
    for c in (msg.get('content') or []):
        if isinstance(c, dict) and c.get('type') == 'text':
            out.append(c.get('text', ''))
    return '\n'.join(out)[:limit]

def main():
    dirs = []
    for proj in sorted(os.listdir(SESS)):
        pd = os.path.join(SESS, proj)
        if not os.path.isdir(pd): continue
        for sub in sorted(os.listdir(pd)):
            p = os.path.join(pd, sub, 'session.v4.jsonl.zstd')
            if os.path.exists(p): dirs.append((proj, sub, p))
    failures, retries, toolerrs, perfail, sessinfo = [], [], [], [], []
    for proj, sub, p in dirs:
        evs = load(p)
        if not evs: continue
        hdr = evs[0] if evs[0].get('type') == 'session' else {}
        sid = hdr.get('id') or sub
        cur = {'provider': None, 'model': None}
        desc = next((e.get('data', {}) for e in evs if e.get('type') == 'subagent/descriptor'), {})
        turns = collections.Counter()
        first_t = evs[0].get('time') or 0
        last_t = 0
        calls = collections.Counter()
        terrs = collections.Counter()
        retry_n = 0
        attempt_n = 0
        for e in evs:
            t = e.get('type'); d = e.get('data') or {}; tm = e.get('time') or 0
            last_t = max(last_t, tm)
            if t in ('request/header',):
                c = (d.get('header') or {}).get('config') or {}
                if c.get('model'): cur = {'provider': c.get('provider'), 'model': c.get('model')}
            elif t == 'request/context':
                if d.get('model'): cur = {'provider': d.get('provider'), 'model': d.get('model')}
            elif t == 'model/selection':
                if d.get('model'): cur = {'provider': d.get('provider'), 'model': d.get('model')}
            elif t == 'tool/call':
                calls[d.get('name')] += 1
            elif t == 'tool/result':
                msg = d.get('message') or {}
                err = d.get('error') or msg.get('error')
                iserr = bool(err) or bool(msg.get('isError')) or bool(d.get('isError'))
                if iserr:
                    nm = 'TEXT_IS_ERROR' if not err else err.get('name')
                    cd = 'TEXT_IS_ERROR' if not err else err.get('code')
                    terrs[f'{nm}/{cd}'] += 1
            elif t == 'turn/end':
                r = d.get('reason') or {}
                turns[r.get('kind')] += 1
                if r.get('error'):
                    failures.append({'sid': sid, 'proj': proj, 'kind': 'turn/end',
                                     'time': tm, 'provider': cur['provider'], 'model': cur['model'],
                                     'code': r['error'].get('code'), 'message': r['error'].get('message'),
                                     'turn': d.get('turn'), 'seq': e.get('seq')})
            elif t == 'assistant/attempt':
                attempt_n += 1
                for ch in d.get('stream') or []:
                    ch = ch.get('chunk') or {}
                    if ch.get('type') == 'finish' and (ch.get('reason') or {}).get('kind') == 'error':
                        f = (ch['reason'].get('failure') or {})
                        failures.append({'sid': sid, 'proj': proj, 'kind': 'attempt',
                                         'time': tm, 'provider': cur['provider'], 'model': cur['model'],
                                         'code': f.get('code'), 'message': f.get('message') or f.get('status'),
                                         'turn': d.get('turn'), 'step': d.get('step'), 'seq': e.get('seq')})
            elif t in ('llm/retry', 'llm/retry-started'):
                retry_n += 1
                retries.append({'sid': sid, 'proj': proj, 'type': t, 'time': tm,
                                'provider': cur['provider'], 'model': cur['model'],
                                'data': {k: d.get(k) for k in list(d)[:12]}, 'seq': e.get('seq')})
        # provider-list failures inside tool results / assistant text
        for e in evs:
            s = json.dumps(e, ensure_ascii=False)
            if 'ProviderNotFoundError' in s and e.get('type') in ('tool/result', 'turn/end', 'assistant/attempt'):
                perfail.append({'sid': sid, 'proj': proj, 'type': e.get('type'), 'time': e.get('time'),
                                'provider': cur['provider'], 'model': cur['model'],
                                'seq': e.get('seq'), 'snippet': s[:300]})
        sessinfo.append({'sid': sid, 'proj': proj, 'descProvider': desc.get('agentProvider'),
                         'descModel': desc.get('agentModel'), 'first': first_t, 'last': last_t,
                         'events': len(evs), 'toolCalls': sum(calls.values()),
                         'toolCounts': dict(calls), 'toolErrors': dict(terrs),
                         'toolErrorTotal': sum(terrs.values()),
                         'attempts': attempt_n, 'retries': retry_n,
                         'turnKinds': dict(turns), 'parent': hdr.get('parentSession'),
                         'preset': hdr.get('agentPreset')})
    def dump(name, rows):
        with open(os.path.join(OUT, name), 'w') as f:
            for r in rows: f.write(json.dumps(r, ensure_ascii=False) + '\n')
    dump('failures.jsonl', failures)
    dump('retries.jsonl', retries)
    dump('perfail.jsonl', perfail)
    json.dump(sessinfo, open(os.path.join(OUT, 'perfail.json'), 'w'), ensure_ascii=False, indent=1)
    print('sessions', len(sessinfo), 'failures', len(failures), 'retries', len(retries), 'providerNotFound', len(perfail))
    print('failure codes:', collections.Counter((f['code']) for f in failures))

if __name__ == '__main__':
    main()
