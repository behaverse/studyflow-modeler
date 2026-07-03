import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import path from 'node:path';

import { test } from '@playwright/test';
import { BpmnModdle } from 'bpmn-moddle';

import { SCHEMAS } from '../src/lib/core/constants';
import { fromModdleYaml, toModdlePackages } from '../src/lib/core/schema';
import { xmlToStudyflow, studyflowToXml } from '../src/lib/core/studyflowYaml';

const ROOT = process.cwd();
const SCHEMA_DIR = path.join(ROOT, 'src/assets/schemas');

function buildModdle() {
  const texts = SCHEMAS.map(({ prefix }) => readFileSync(path.join(SCHEMA_DIR, `${prefix}.moddle.yaml`), 'utf8'));
  const models = texts.map((t) => fromModdleYaml(t));
  const packages: Record<string, any> = {};
  for (const model of models) packages[model.prefix] = toModdlePackages(model, models);
  return () => new BpmnModdle(packages);
}

// Convert existing XML examples to YAML so we can read the exact target shape.
test('dump existing examples to YAML', async () => {
  const make = buildModdle();
  const names = ['consort2025', 'function_call_demo', 'cognitive_battery'];
  for (const name of names) {
    const xmlPath = path.join(ROOT, 'src/assets/examples', `${name}.studyflow`);
    if (!existsSync(xmlPath)) continue;
    const xml = readFileSync(xmlPath, 'utf8');
    const yamlText = await xmlToStudyflow(xml, make());
    writeFileSync(path.join('/private/tmp/claude-501/-Users-morteza-workspace-behaverse-studyflow-modeler/2068e2cd-5ec7-4ad5-adc0-4233c61062e8/scratchpad', `${name}.yaml`), yamlText);
  }
  const paperDir = '/Users/morteza/workspace/behaverse/studyflow-paper/elife';
  for (const [src, out] of [['figures/rt_analysis.studyflow', 'rt_analysis.yaml'], ['figures/example.studyflow', 'fig2_example_study.yaml']] as const) {
    const xmlPath = path.join(paperDir, src);
    if (!existsSync(xmlPath)) continue;
    const xml = readFileSync(xmlPath, 'utf8');
    const yamlText = await xmlToStudyflow(xml, make());
    writeFileSync(path.join('/private/tmp/claude-501/-Users-morteza-workspace-behaverse-studyflow-modeler/2068e2cd-5ec7-4ad5-adc0-4233c61062e8/scratchpad', out), yamlText);
  }
});

// Validate authored YAML files round-trip through XML and back.
test('validate authored figures', async () => {
  const make = buildModdle();
  const dir = process.env.FIG_DIR;
  if (!dir) return;
  const files = (process.env.FIG_FILES ?? '').split(',').filter(Boolean);
  const results: string[] = [];
  for (const f of files) {
    try {
      const yamlText = readFileSync(path.join(dir, f), 'utf8');
      const xml = await studyflowToXml(yamlText, make());
      await xmlToStudyflow(xml, make());
      results.push(`OK ${f} (${xml.length} bytes XML)`);
    } catch (e: any) {
      results.push(`FAIL ${f}: ${e?.message ?? e}`);
    }
  }
  writeFileSync(path.join('/private/tmp/claude-501/-Users-morteza-workspace-behaverse-studyflow-modeler/2068e2cd-5ec7-4ad5-adc0-4233c61062e8/scratchpad', 'validation.txt'), results.join('\n'));
});
