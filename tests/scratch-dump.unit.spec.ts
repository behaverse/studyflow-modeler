import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { test } from '@playwright/test';
import { BpmnModdle } from 'bpmn-moddle';

import { studyflowToXml } from '../src/core/codec';
import { SCHEMAS } from '../src/core/constants';
import { fromModdleYaml, toModdlePackages } from '../src/core/schema';
import { ensureDiagramLayout } from '../src/modeler/models/autoLayout';

const SCHEMA_DIR = path.join(process.cwd(), 'src/assets/schemas');
const models = SCHEMAS.map(({ prefix }) =>
  fromModdleYaml(readFileSync(path.join(SCHEMA_DIR, `${prefix}.moddle.yaml`), 'utf8')),
);
const packages: Record<string, any> = Object.fromEntries(
  models.map((model) => [model.prefix, toModdlePackages(model, models)]),
);

const OUT = '/private/tmp/claude-501/-Users-morteza-workspace-behaverse-studyflow-modeler/6856ce97-f8e1-4d13-9ece-b2b9423cea26/scratchpad';

for (const example of ['ml_pipeline', 'agent_eval']) {
  test(`dump laid-out ${example}`, async () => {
    const text = readFileSync(path.join(process.cwd(), `src/assets/examples/${example}.studyflow`), 'utf8');
    const xml = await studyflowToXml(text, new BpmnModdle(structuredClone(packages)) as any);
    writeFileSync(path.join(OUT, `${example}.xml`), xml);
    const laidOut = await ensureDiagramLayout(xml);
    writeFileSync(path.join(OUT, `${example}.laidout.xml`), laidOut);
  });
}
