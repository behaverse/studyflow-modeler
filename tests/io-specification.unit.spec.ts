
import { expect, test } from '@playwright/test';
import { BpmnModdle } from 'bpmn-moddle';

import { toModdlePackages } from '@behaverse/studyflow-core/notation/schemaFile';
import { buildCatalog, setCatalog } from '@behaverse/studyflow-core/notation';
import { fromStandardBpmnXml, studyflowToXml, toStandardBpmnXml, xmlToStudyflow } from '@behaverse/studyflow-core/document';
import { loadSchemaModels } from './schemas';
import { exampleStudyflow } from './utils';

/** Exported `.bpmn` carries the full `ioSpecification`; reading it back folds to the compact `binding` form. */

const models = loadSchemaModels();
setCatalog(buildCatalog(models));
const packages: Record<string, any> = Object.fromEntries(
  models.map((model) => [model.prefix, toModdlePackages(model, models)]),
);

function exampleYaml(filename: string): Promise<string> {
  return exampleStudyflow(filename, new BpmnModdle(structuredClone(packages)) as any);
}

test.describe('standard-BPMN ioSpecification boundary', () => {
  test('lowering produces the complete standard structure', async () => {
    const moddle = new BpmnModdle(structuredClone(packages)) as any;
    const compactXml = await studyflowToXml(await exampleYaml('sklearn_pipeline.studyflow.png'), moddle);
    const standardXml = await toStandardBpmnXml(compactXml, moddle);

    expect(standardXml).toContain('<bpmn:ioSpecification id="Cross_Validate_io">');
    expect(standardXml).toContain('<bpmn:dataInput id="Cross_Validate_in_estimator" name="estimator" />');
    expect(standardXml).toContain('<bpmn:dataInput id="Cross_Validate_in_X" name="X" />');
    expect(standardXml).toContain('<bpmn:dataInput id="Cross_Validate_in_y" name="y" />');
    expect(standardXml).toContain('<bpmn:dataOutput id="Cross_Validate_result" name="result" />');
    expect(standardXml).toContain('<bpmn:inputSet id="Cross_Validate_inputSet">');
    expect(standardXml).toContain('<bpmn:outputSet id="Cross_Validate_outputSet">');
    expect(standardXml).toContain('<bpmn:dataInputRefs>Cross_Validate_in_X</bpmn:dataInputRefs>');
    expect(standardXml).toContain('<bpmn:dataOutputRefs>Cross_Validate_result</bpmn:dataOutputRefs>');
    expect(standardXml).toContain('<bpmn:targetRef>Cross_Validate_in_X</bpmn:targetRef>');
    expect(standardXml).toContain('<bpmn:sourceRef>Cross_Validate_result</bpmn:sourceRef>');
    expect(standardXml).not.toContain('studyflow:binding');
  });

  test('folding the standard form back yields the shipped compact YAML', async () => {
    const moddle = new BpmnModdle(structuredClone(packages)) as any;
    const compactXml = await studyflowToXml(await exampleYaml('sklearn_pipeline.studyflow.png'), moddle);
    const standardXml = await toStandardBpmnXml(compactXml, moddle);

    const roundTripped = await xmlToStudyflow(standardXml, new BpmnModdle(structuredClone(packages)) as any);
    expect(roundTripped).toBe(await exampleYaml('sklearn_pipeline.studyflow.png'));
  });

  test('a default-named binding folds back without a binding attribute', async () => {
    const moddle = new BpmnModdle(structuredClone(packages)) as any;
    // DataInput_Prompt_In carries no slot (binding defaults to the element's name) — do not invent one.
    const agentYaml = await exampleYaml('agent_eval.studyflow.png');
    const standardXml = await toStandardBpmnXml(await studyflowToXml(agentYaml, moddle), moddle);
    expect(standardXml).toContain('name="Agent instructions"');
    const roundTripped = await xmlToStudyflow(standardXml, new BpmnModdle(structuredClone(packages)) as any);
    // Namespace declarations are serializer bookkeeping (the compact attrs are gone); compare the semantic document.
    const withoutXmlns = (yamlText: string) => yamlText.replace(/^ {2}xmlns:[^\n]*\n/gm, '');
    expect(withoutXmlns(roundTripped)).toBe(withoutXmlns(agentYaml));
  });

  test('an association that sources from nothing survives lower -> fold unchanged', async () => {
    const compact = `<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL" id="phantom_binding" targetNamespace="http://bpmn.io/schema/bpmn">
  <bpmn:process id="Process_1" isExecutable="false">
    <bpmn:task id="Step" name="Step">
      <bpmn:dataInputAssociation id="DIA_1" />
    </bpmn:task>
  </bpmn:process>
</bpmn:definitions>`;

    const standard = await toStandardBpmnXml(compact, new BpmnModdle(structuredClone(packages)) as any);
    expect(standard).toContain('<bpmn:dataInput id="Step_in_input" name="input" />');
    expect(standard).not.toContain('transformation');

    const folded = await fromStandardBpmnXml(standard, new BpmnModdle(structuredClone(packages)) as any);
    expect(folded).not.toContain('transformation');
    expect(folded).not.toContain('ioSpecification');

    const relowered = await toStandardBpmnXml(folded, new BpmnModdle(structuredClone(packages)) as any);
    expect(relowered).toBe(standard);
  });
});
