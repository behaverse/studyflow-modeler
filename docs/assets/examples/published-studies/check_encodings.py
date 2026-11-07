"""Check each encoded study against its quote record and its article on PubMed Central, and count what the articles
state (the table of docs/published-studies.qmd). <name>.quotes.json gives, for each of the 20 checklist values, whether
the article states it and the words it was read from; a value read from a figure is checked by the sentence that cites
the figure.

    python3 docs/assets/examples/published-studies/check_encodings.py
"""
import json
import re
import statistics
import sys
import tempfile
import urllib.request
from pathlib import Path

import yaml

HERE = Path(__file__).resolve().parent
BIOC = 'https://www.ncbi.nlm.nih.gov/research/bionlp/RESTful/pmcoa.cgi/BioC_json/{}/unicode'
CACHE = Path(tempfile.gettempdir()) / 'studyflow-encoded-articles'
SETTINGS = ['stimuli', 'conditions', 'congruentProportion', 'trials', 'blocks', 'practice', 'trialOrder', 'randomSeed',
            'fixation', 'stimulusDuration', 'responseDeadline', 'interTrialInterval', 'responseMapping', 'feedback',
            'missedResponse']
CHECKLIST = SETTINGS + ['platform', 'sample', 'participantExclusion', 'trialExclusion', 'analysisImplementation']


def squash(text):
    return re.sub(r'\s+', ' ', text).strip()


def paragraphs(pmc):
    """The article's paragraphs, titles and captions as PubMed Central's BioC service gives them, without references."""
    path = CACHE / f'{pmc}.json'
    if not path.exists():
        CACHE.mkdir(exist_ok=True)
        with urllib.request.urlopen(BIOC.format(pmc), timeout=60) as response:
            path.write_bytes(response.read())
    data = json.loads(path.read_text())
    doc = (data[0] if isinstance(data, list) else data)['documents'][0]
    return [squash(p.get('text', '')) for p in doc['passages']
            if p.get('infons', {}).get('section_type') != 'REF' and p.get('infons', {}).get('type') != 'ref']


def elements(node):
    """Every element of the process, nested ones included."""
    for key, value in (node.get('elements') or {}).items():
        if isinstance(value, dict):
            yield key, value
            yield from elements(value)


def statuses(path):
    """Each checklist item's status in the diagram."""
    doc = yaml.safe_load(path.read_text())
    process = next(v for v in doc.values() if isinstance(v, dict) and v.get('type') == 'Process')
    found = {}
    for key, e in elements(process):
        values = (e.get('studyflow:Parameters') or {}).get('values') or {}
        if 'stimuli' in values:
            if [k for k in values if k in SETTINGS] != SETTINGS:
                found['_order'] = f'settings keys {[k for k in values if k in SETTINGS]}'
            for k in SETTINGS:
                if k in values:
                    found[k] = 'unstated' if values[k] == 'unstated' else 'stated'
        task = e.get('cognitive:CognitiveTask')
        if isinstance(task, dict) and 'platform' in task:
            found['platform'] = 'unstated' if task['platform'] == 'unstated' else 'stated'
        if key == 'Enroll':
            found['sample'] = 'stated' if re.search(r'\d', str(e.get('name', ''))) else 'unstated'
        gate = e.get('cognitive:EligibilityGateway')
        if key == 'Exclusion' and isinstance(gate, dict) and 'exclusionCriteria' in gate:
            found['participantExclusion'] = 'unstated' if gate['exclusionCriteria'] == ['unstated'] else 'stated'
        if key == 'Select_Trials':
            found['trialExclusion'] = 'unstated' if 'unstated' in str(e.get('name', '')) else 'stated'
        if key == 'Analysis':
            found['analysisImplementation'] = ('unstated' if str(e.get('implementation', '')).startswith('unstated')
                                               else 'stated')
    return found


rows, problems = [], []
for record_path in sorted(HERE.glob('*.quotes.json')):
    record = json.loads(record_path.read_text())
    name, items = record['file'], record['items']
    text = paragraphs(record['pmc'])
    if [i['item'] for i in items] != CHECKLIST:
        problems.append(f'{name}: items {[i["item"] for i in items]}')
    for i in items + record.get('extra', []):
        if i['status'] != 'stated':
            continue
        if not i.get('quote'):
            problems.append(f'{name}: {i["item"]}: stated without a quote')
        for field in ('quote', 'quote2'):
            quote = squash(i.get(field, ''))
            if quote and not any(quote in p for p in text):
                problems.append(f'{name}: {i["item"]}: {field} not in the article: {quote[:100]!r}')
    found = statuses(HERE / f'{name}.studyflow.yaml')
    if '_order' in found:
        problems.append(f'{name}: {found.pop("_order")}')
    for i in items:
        if found.get(i['item']) != i['status']:
            problems.append(f'{name}: {i["item"]}: the record says {i["status"]}, the diagram {found.get(i["item"])}')
    stated = [i for i in items if i['status'] == 'stated']
    rows.append({'name': name, 'stated': len(stated), 'unstated': [i['item'] for i in items if i['status'] != 'stated'],
                 'where': {i['item']: i.get('where', 'Method') for i in stated}})

for r in rows:
    elsewhere = ', '.join(f'{k} ({w})' for k, w in r['where'].items() if w != 'Method') or '-'
    print(f'{r["name"]:22} {r["stated"]:2} of 20 stated; outside the Method: {elsewhere}')
    print(f'{"":22} unstated: {", ".join(r["unstated"])}')
counts = sorted(((sum(k in r['unstated'] for r in rows), k) for k in CHECKLIST), reverse=True)
stated = [r['stated'] for r in rows]
print(f'\n{len(rows)} studies; stated {min(stated)} to {max(stated)} of 20, median {statistics.median(stated):g}')
print('unstated in how many:', ', '.join(f'{k} {n}' for n, k in counts if n))
print(f"trial selection only in the Results: {sum(r['where'].get('trialExclusion') == 'Results' for r in rows)}; "
      f"values read from a figure: {sum('Figure' in r['where'].values() for r in rows)} studies")
print('\n'.join(problems) or 'no problems')
sys.exit(1 if problems else 0)
