import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

// The OMG's BPMN 2.0 schema, as bpmn-moddle ships it: BPMN20.xsd includes Semantic.xsd and imports the diagram
// interchange schemas, each by its file name.
import BPMN20 from 'bpmn-moddle/resources/bpmn/xsd/BPMN20.xsd?raw';
import BPMNDI from 'bpmn-moddle/resources/bpmn/xsd/BPMNDI.xsd?raw';
import DC from 'bpmn-moddle/resources/bpmn/xsd/DC.xsd?raw';
import DI from 'bpmn-moddle/resources/bpmn/xsd/DI.xsd?raw';
import Semantic from 'bpmn-moddle/resources/bpmn/xsd/Semantic.xsd?raw';

const SCHEMAS: Record<string, string> = { 'BPMN20.xsd': BPMN20, 'BPMNDI.xsd': BPMNDI, 'DC.xsd': DC, 'DI.xsd': DI, 'Semantic.xsd': Semantic };

/**
 * Where BPMN XML breaks the OMG's XSD, one message a violation, or undefined when this machine has no `xmllint`
 * (libxml2's, which macOS and most Linux distributions ship) to ask.
 */
export function xsdViolations(xml: string): string[] | undefined {
  const dir = mkdtempSync(path.join(tmpdir(), 'studyflow-xsd-'));
  try {
    for (const [name, text] of Object.entries(SCHEMAS)) writeFileSync(path.join(dir, name), text);
    writeFileSync(path.join(dir, 'study.bpmn'), xml);
    const checked = spawnSync('xmllint', ['--noout', '--schema', 'BPMN20.xsd', 'study.bpmn'], { cwd: dir, encoding: 'utf8' });
    if (checked.error) return undefined;
    // `study.bpmn:12: element task: Schemas validity error : Element '{…}task', attribute …: …`
    return checked.stderr.split('\n').filter((line) => line.includes('validity error'))
      .map((line) => line.replace(/^study\.bpmn:(\d+): element \S+: Schemas validity error : /, 'line $1: ')
        .replace(/\{http:\/\/www\.omg\.org\/spec\/BPMN\/20100524\/MODEL\}/g, 'bpmn:').replace(/\{[^}]*\}/g, ''));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
