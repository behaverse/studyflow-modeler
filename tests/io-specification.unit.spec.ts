
import { expect, test } from '@playwright/test';
import { BpmnModdle } from 'bpmn-moddle';

import { toModdlePackages } from '../src/core/schema';
import { buildCatalog, setCatalog } from '../src/core/catalog';
import { studyflowToXml, xmlToStudyflow } from '../src/core/codec';
import { toStandardBpmnXml } from '../src/core/codec/io-specification';
import { loadSchemaModels } from './schemas';
import { exampleStudyflow } from './utils';

/**
 * The standard-BPMN I/O boundary passes: exported `.bpmn` XML carries the
 * full `ioSpecification` structure (named DataInputs per association, a `result`
 * DataOutput, InputSet/OutputSet, natively retargeted associations, no
 * binding extension attributes), and reading that XML back folds it into the
 * compact `parameter` form losslessly.
 */

const models = loadSchemaModels();
setCatalog(buildCatalog(models));
const packages: Record<string, any> = Object.fromEntries(
  models.map((model) => [model.prefix, toModdlePackages(model, models)]),
);

/** The shipped example as `.studyflow` YAML, read out of the PNG it ships as. */
function exampleYaml(filename: string): Promise<string> {
  return exampleStudyflow(filename, new BpmnModdle(structuredClone(packages)) as any);
}

test.describe('standard-BPMN ioSpecification boundary', () => {
  test('lowering produces the complete standard structure', async () => {
    const moddle = new BpmnModdle(structuredClone(packages)) as any;
    const compactXml = await studyflowToXml(await exampleYaml('sklearn_pipeline.png'), moddle);
    const standardXml = await toStandardBpmnXml(compactXml, moddle);

    // The step with data associations's parameters became named DataInputs of an ioSpecification.
    expect(standardXml).toContain('<bpmn:ioSpecification id="Cross_Validate_io">');
    expect(standardXml).toContain('<bpmn:dataInput id="Cross_Validate_in_estimator" name="estimator" />');
    expect(standardXml).toContain('<bpmn:dataInput id="Cross_Validate_in_X" name="X" />');
    expect(standardXml).toContain('<bpmn:dataInput id="Cross_Validate_in_y" name="y" />');
    // The return value is one DataOutput, grouped by the mandatory sets.
    expect(standardXml).toContain('<bpmn:dataOutput id="Cross_Validate_result" name="result" />');
    expect(standardXml).toContain('<bpmn:inputSet id="Cross_Validate_inputSet">');
    expect(standardXml).toContain('<bpmn:outputSet id="Cross_Validate_outputSet">');
    expect(standardXml).toContain('<bpmn:dataInputRefs>Cross_Validate_in_X</bpmn:dataInputRefs>');
    expect(standardXml).toContain('<bpmn:dataOutputRefs>Cross_Validate_result</bpmn:dataOutputRefs>');
    // Associations retarget natively; the extension attribute is gone.
    expect(standardXml).toContain('<bpmn:targetRef>Cross_Validate_in_X</bpmn:targetRef>');
    expect(standardXml).toContain('<bpmn:sourceRef>Cross_Validate_result</bpmn:sourceRef>');
    expect(standardXml).not.toContain('exec:parameter');
  });

  test('folding the standard form back yields the shipped compact YAML', async () => {
    const moddle = new BpmnModdle(structuredClone(packages)) as any;
    const compactXml = await studyflowToXml(await exampleYaml('sklearn_pipeline.png'), moddle);
    const standardXml = await toStandardBpmnXml(compactXml, moddle);

    const roundTripped = await xmlToStudyflow(standardXml, new BpmnModdle(structuredClone(packages)) as any);
    expect(roundTripped).toBe(await exampleYaml('sklearn_pipeline.png'));
  });

  test('a default-named binding folds back without a parameter attribute', async () => {
    const moddle = new BpmnModdle(structuredClone(packages)) as any;
    // DataInput_Prompt_In in agent_eval carries no `parameter` (binding defaults
    // to the element's name) - the round trip must not invent one.
    const agentYaml = await exampleYaml('agent_eval.png');
    const standardXml = await toStandardBpmnXml(await studyflowToXml(agentYaml, moddle), moddle);
    expect(standardXml).toContain('name="Agent instructions"');
    const roundTripped = await xmlToStudyflow(standardXml, new BpmnModdle(structuredClone(packages)) as any);
    // Namespace declarations are serializer bookkeeping: the lowered XML uses
    // no exec-prefixed content (the `parameter` attributes became DataInputs),
    // so `xmlns:exec` is not re-declared. Compare the semantic document.
    const withoutXmlns = (yamlText: string) => yamlText.replace(/^ {2}xmlns:[^\n]*\n/gm, '');
    expect(withoutXmlns(roundTripped)).toBe(withoutXmlns(agentYaml));
  });
});
