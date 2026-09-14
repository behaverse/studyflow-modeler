import { expect, test } from '@playwright/test';

import { extractStudyflowFromSvg, replaceStudyflowInSvg } from '@core/document/svg';

/** The modeler's SVG export nests the BPMN `<definitions>` in `<metadata>`; the CLI reads it without a DOM. */

test.describe('SVG studyflow embedding', () => {
  test('reads the nested BPMN XML back, whatever its prefix', () => {
    const definitions = '<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL" id="D">'
      + '<bpmn:process id="P"><bpmn:sequenceFlow id="F"><bpmn:conditionExpression>a &lt; b</bpmn:conditionExpression></bpmn:sequenceFlow></bpmn:process>'
      + '</bpmn:definitions>';
    const svg = (payload: string) => `<svg xmlns="http://www.w3.org/2000/svg"><metadata>${payload}</metadata><g class="sf-shape"/></svg>`;

    expect(extractStudyflowFromSvg(svg(definitions))).toBe(definitions);
    const unprefixed = definitions.replace(/bpmn:(?!=)/g, '').replace('xmlns:bpmn', 'xmlns');
    expect(extractStudyflowFromSvg(svg(unprefixed))).toBe(unprefixed);

    // A run keeps the drawing and swaps the studyflow in it for the stamped one.
    const stamped = definitions.replace('id="P"', 'id="P" name="stamped"');
    expect(replaceStudyflowInSvg(svg(definitions), `<?xml version="1.0" encoding="UTF-8"?>\n${stamped}`)).toBe(svg(stamped));
  });

  test('throws on an SVG without a studyflow', () => {
    expect(() => extractStudyflowFromSvg('<svg xmlns="http://www.w3.org/2000/svg"><g/></svg>')).toThrow(/carries no studyflow/);
  });
});
