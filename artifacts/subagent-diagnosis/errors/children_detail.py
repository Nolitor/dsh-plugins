#!/usr/bin/env python3
"""Per-child (7 children of session-e42cf5d8) tool-call error taxonomy.
Read-only on ~/.dsh; writes children_detail.json in this dir."""
import json, os, subprocess, collections, re

SESSBASE = os.path.expanduser('~/.dsh/sessions/--home-minami-Workspace-projects-dsh-workspace-dsh-plugins--')
PARENT = 'session-e42cf5d8-b927-42fc-814b-6b30a38f9983'
OUT = os.path.dirname(os.path.abspath(__file__))
IDS = ['59429101', '1217d636', '5b72bfc9', '5d17dd9f', 'b70d93d8', '022a9249', '72fa9915']

TS_COMPILE = re.compile(r'TypeScript|error TS\d+|Unexpected token|Expected |SyntaxError|parse error|Transform failed|ERROR: ', re.I)
RUNTIME = re.compile(r'TypeError|ReferenceError|RangeError|Cannot read|is not defined|Cannot find module|MODULE_NOT_FOUND|undefined is not|exception', re.I)
TOOLCALL = re.compile(r'ToolCallError|ToolArgsError|ToolNotFoundError|UNKNOWN_TOOL|INVALID_ARGS|invalid arguments|SchemaError', re.I)
OLDSTR = re.compile(r'old_string|oldString|not found in the file|No exact match', re.I)

def load(path):
    return [json.loads(l) for l in subprocess.run(['zstd', '-d', '-c', path], capture_output=True).stdout.decode('utf-8', 'replace').splitlines() if l.strip()]

def msg_text(d):
    msg = d.get('message') or {}
    out = []
    for c in (msg.get('content') or []):
        if isinstance(c, dict) and c.get('type') == 'text': out.append(c.get('text', ''))
    return '\n'.join(out)

def main():
    res = []
    for i in IDS:
        d = next(x for x in os.listdir(SESSBASE) if x.startswith(i))
        p = os.path.join(SESSBASE, d, 'session.v4.jsonl.zstd')
        evs = load(p)
        hdr = evs[0]
        desc = next((e['data'] for e in evs if e['type'] == 'subagent/descriptor'), {})
        calls = {}
        for e in evs:
            if e['type'] == 'tool/call':
                calls[e['data']['callId']] = e['data']
        root_errs, sub_errs = [], []
        for e in evs:
            if e['type'] == 'tool/result':
                dat = e['data']; msg = dat.get('message') or {}
                err = dat.get('error') or msg.get('error')
                if not (err or msg.get('isError') or dat.get('isError')): continue
                txt = msg_text(dat)
                name = (err or {}).get('name', 'TEXT_IS_ERROR')
                code = (err or {}).get('code', 'TEXT_IS_ERROR')
                cat = []
                if name == 'ToolArgsError' or code == 'INVALID_ARGS': cat.append('invalid_tool_args')
                elif name == 'ToolNotFoundError' or code == 'UNKNOWN_TOOL': cat.append('unknown_tool')
                elif name == 'CodeRunFailedError':
                    if TS_COMPILE.search(txt): cat.append('ptc_compile')
                    elif RUNTIME.search(txt): cat.append('runtime_js')
                    elif TOOLCALL.search(txt): cat.append('tool_call_inside_ptc')
                    elif OLDSTR.search(txt): cat.append('old_string_not_found')
                    else: cat.append('code_run_failed_other')
                else: cat.append('other')
                root_errs.append({'seq': e['seq'], 'time': e['time'], 'step': dat.get('step'),
                                  'name': name, 'code': code, 'cat': cat,
                                  'text': txt[:500]})
            elif e['type'] == 'tool/ptc-dispatch':
                dat = e['data']
                if dat.get('isError'):
                    txt = msg_text({'message': {'content': dat.get('content') or []}})
                    sub_errs.append({'seq': e['seq'], 'time': e['time'], 'name': dat.get('name'),
                                     'text': txt[:400]})
        allcalls = len(calls)
        cats = collections.Counter(c for er in root_errs for c in er['cat'])
        sub_tool = collections.Counter(s['name'] for s in sub_errs)
        res.append({'sid': d, 'model': desc.get('agentModel'), 'label': desc.get('label'),
                    'events': len(evs), 'toolCalls': allcalls,
                    'toolCallNames': dict(collections.Counter(c['name'] for c in calls.values())),
                    'rootErrorCount': len(root_errs), 'rootErrorCats': dict(cats),
                    'rootErrors': root_errs, 'subDispatchErrors': len(sub_errs),
                    'subDispatchErrorTools': dict(sub_tool), 'subErrors': sub_errs,
                    'turnEnd': [e['data'].get('reason') for e in evs if e['type'] == 'turn/end'],
                    'createdAt': hdr.get('createdAt')})
    json.dump(res, open(os.path.join(OUT, 'children_detail.json'), 'w'), ensure_ascii=False, indent=1)
    for r in res:
        print('=' * 70)
        print(r['sid'][:8], r['model'], 'calls', r['toolCalls'], 'rootErr', r['rootErrorCount'],
              'subErr', r['subDispatchErrors'])
        print('  cats', r['rootErrorCats'], 'subTools', r['subDispatchErrorTools'])
        for er in r['rootErrors'][:20]:
            print(f"   seq {er['seq']} step {er['step']} {er['name']}/{er['code']} {er['cat']} :: {er['text'][:170].replace(chr(10),' ')}")

if __name__ == '__main__':
    main()
