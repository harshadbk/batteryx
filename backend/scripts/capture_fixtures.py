"""Capture REAL backend responses (FastAPI TestClient, in-memory SQLite) as frontend test fixtures."""
import sys, json, copy
sys.path.insert(0, '.')
from fastapi.testclient import TestClient
from app.main import create_app
from app.config import Settings
c = TestClient(create_app('sqlite://', settings=Settings(db_backend='sql', database_url='sqlite://')))
ex = c.get('/api/v1/examples/designs').json()
reqs = ex['designs'][0]['requirements']
designs = [{k: v for k, v in d.items() if k != 'requirements'} for d in ex['designs']]
proj = c.post('/api/v1/projects', json={'name': 'Fixture project', 'application': 'stationary solar storage', 'designs': designs, 'requirements': reqs}).json()
A = dict(designs[0], requirements=reqs)
out = {'_note': 'Captured from the real BatteryX backend (illustrative example inputs). Regenerate with backend/scripts/capture_fixtures.py.',
       'health': c.get('/health').json(), 'models': c.get('/api/v1/models').json(), 'metrics': c.get('/api/v1/metrics').json(),
       'cells': c.get('/api/v1/cells').json(), 'examples': ex, 'project': proj, 'projects': c.get('/api/v1/projects').json(),
       'ai_status': {'configured': False, 'provider': 'groq', 'model': 'openai/gpt-oss-120b'}, 'modules': {}}
for m in ['configuration', 'energy', 'estimates', 'thermal', 'ageing', 'bms', 'mechanical', 'cost', 'simulate/charge', 'simulate/discharge']:
    r = c.post(f'/api/v1/{m}', json=A); assert r.status_code == 200, (m, r.text); out['modules'][m] = r.json()
out['evaluate'] = {d['name']: c.post('/api/v1/designs/evaluate', json=dict(d, requirements=reqs)).json() for d in designs}
out['compare'] = c.post('/api/v1/designs/compare', json={'baseline': dict(designs[0], requirements=reqs), 'alternatives': [dict(d, requirements=reqs) for d in designs[1:]]}).json()
out['variation'] = c.post('/api/v1/variation', json={'design': A, 'variation': {'samples': 200, 'capacity_tolerance_pct': 3, 'resistance_tolerance_pct': 15}}).json()
json.dump(out, open(sys.argv[1], 'w', encoding='utf-8'), ensure_ascii=False)
print('ok', round(len(json.dumps(out)) / 1024), 'KB')

# ---- copilot turn: a SCRIPTED Claude stand-in (no API call) drives REAL engine tools; used only for UI tests.
from types import SimpleNamespace as NS
from app.ai.claude_client import ClaudeClient
U = NS(input_tokens=0, output_tokens=0, cache_read_input_tokens=0)
def _final(kw):
    res = {}
    for m in kw['messages']:
        if m['role'] == 'user' and isinstance(m['content'], list):
            for b in m['content']:
                r = json.loads(b['content']); res[r['ref']] = r
    t = res['T1']['kpis']['peak_cell_temp_charge_c']; e = res['T2']['kpis']['usable_energy_wh']
    obj = {'summary': 'Baseline stays below the charge temperature limit; a 4S2P variant doubles usable energy.',
           'answer_markdown': f'Estimated peak charge temperature of the baseline is {t} °C (T1). The 4S2P variant gives {e} Wh usable (T2).',
           'claims': [{'statement': 'Baseline peak cell temperature (charge)', 'value': t, 'unit': '°C', 'source_ref': 'T1', 'basis': 'engine_estimate'},
                      {'statement': '4S2P usable energy', 'value': e, 'unit': 'Wh', 'source_ref': 'T2', 'basis': 'engine_estimate'}],
           'recommendations': [{'action': 'Measure the cell-to-ambient thermal resistance', 'rationale': 'R_th is an assumption in every design', 'priority': 'high', 'verified': True, 'source_refs': ['T1']}],
           'candidate_designs': [{'name': 'A + 4S2P', 'base_design': 'A - Baseline', 'changes': [{'path': 'parallel', 'value': 2}], 'evaluated_ref': 'T2', 'verdict': 'Meets energy requirement; heavier.'}],
           'assumptions': ['Thermal model is simplified.'], 'uncertainties': ['Cell data is illustrative.'], 'missing_inputs': ['cell.ocv_curve'],
           'report_sections': [{'title': 'Executive summary', 'body_markdown': f'Baseline usable energy estimate is {res["T1"]["kpis"]["usable_energy_wh"]} Wh.', 'source_refs': ['T1']}],
           'safety_notice': 'Estimates only; screening checks are not a certification.'}
    return NS(content=[NS(type='text', text=json.dumps(obj))], stop_reason='end_turn', usage=U)
_script = [NS(content=[NS(type='tool_use', id='a', name='evaluate_design', input={'design_name': 'A - Baseline', 'changes': [], 'label': None}),
                       NS(type='tool_use', id='b', name='evaluate_design', input={'design_name': 'A - Baseline', 'changes': [{'path': 'parallel', 'value': 2}], 'label': 'A + 4S2P'})],
              stop_reason='tool_use', usage=U), _final]
class _SDK:
    def __init__(s): s.beta = NS(messages=NS(create=s.create)); s.messages = s.beta.messages
    def create(s, **kw):
        st = _script.pop(0); return st(kw) if callable(st) else st
c.app.state.claude = ClaudeClient(sdk_client=_SDK())
r = c.post(f"/api/v1/copilot/projects/{proj['id']}/chat", json={'mode': 'design_copilot', 'message': 'Need at least 400 Wh', 'focus_design': None})
assert r.status_code == 200, r.text
out['copilot_status'] = {'configured': True, 'provider': 'anthropic', 'model': 'claude-opus-5-5', 'effort': 'medium', 'server_side_fallback': True, 'modes': {}}
out['copilot_chat'] = r.json()
out['copilot_conversation'] = c.get(f"/api/v1/copilot/conversations/{r.json()['conversation_id']}").json()
out['copilot_conversations'] = c.get(f"/api/v1/copilot/projects/{proj['id']}/conversations").json()
assert out['copilot_chat']['turn']['verification']['passed'], out['copilot_chat']['turn']['verification']
json.dump(out, open(sys.argv[1], 'w', encoding='utf-8'), ensure_ascii=False)
print('copilot fixture ok')
