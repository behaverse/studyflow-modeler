/**
 * BPMN's own package definitions, as bpmn-moddle ships them: BPMN 2.0, its diagram interchange (bpmndi, dc, di), and
 * the two colour vocabularies bpmn.io reads and writes (bioc, color). With the skills' schemas (`loadSchemas`) they are
 * every package a study's metamodel reads.
 */
import bioc from 'bpmn-moddle/resources/bpmn-io/json/bioc.json';
import bpmn from 'bpmn-moddle/resources/bpmn/json/bpmn.json';
import bpmndi from 'bpmn-moddle/resources/bpmn/json/bpmndi.json';
import dc from 'bpmn-moddle/resources/bpmn/json/dc.json';
import di from 'bpmn-moddle/resources/bpmn/json/di.json';

import { Metamodel, type PackageDef } from '@core/model/metamodel';

/** bpmn-moddle's "BPMN in Color" package, which it defines in its code rather than as a resource. */
const color: PackageDef = {
  name: 'BPMN in Color',
  uri: 'http://www.omg.org/spec/BPMN/non-normative/color/1.0',
  prefix: 'color',
  types: [
    { name: 'ColoredLabel', extends: ['bpmndi:BPMNLabel'], properties: [{ name: 'color', isAttr: true, type: 'String' }] },
    {
      name: 'ColoredShape',
      extends: ['bpmndi:BPMNShape'],
      properties: [{ name: 'background-color', isAttr: true, type: 'String' }, { name: 'border-color', isAttr: true, type: 'String' }],
    },
    { name: 'ColoredEdge', extends: ['bpmndi:BPMNEdge'], properties: [{ name: 'border-color', isAttr: true, type: 'String' }] },
  ],
  enumerations: [],
  associations: [],
};

/** BPMN's packages, a copy per call: a metamodel registers what it is given as its own. */
export function bpmnPackages(): PackageDef[] {
  return structuredClone([bpmn, bpmndi, dc, di, bioc, color] as PackageDef[]);
}

/** The metamodel of BPMN and the schemas `packages` holds (a skill's packages by prefix, as `loadSchemas` gives them). */
export function metamodelOf(packages: Record<string, unknown> = {}): Metamodel {
  return new Metamodel([...bpmnPackages(), ...structuredClone(Object.values(packages)) as PackageDef[]]);
}
