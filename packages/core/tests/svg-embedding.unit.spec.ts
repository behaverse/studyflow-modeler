import { expect, test } from '@playwright/test';

import { extractStudyflowFromSvg } from '@core/document/svg';

/** The modeler's SVG export writes the YAML as the escaped text of `<metadata><studyflow>`; the CLI reads it without a DOM. */

test.describe('SVG studyflow embedding', () => {
  test('reads the escaped YAML back', () => {
    const svg = '<svg xmlns="http://www.w3.org/2000/svg"><metadata xmlns=""><studyflow>when: a &lt; b &amp;&amp; c &gt; d\n'
      + 'name: &#233;tude &#x5B9F;</studyflow></metadata><g class="sf-shape"/></svg>';

    expect(extractStudyflowFromSvg(svg)).toBe('when: a < b && c > d\nname: étude 実');
  });

  test('throws on an SVG without a studyflow', () => {
    expect(() => extractStudyflowFromSvg('<svg xmlns="http://www.w3.org/2000/svg"><g/></svg>')).toThrow(/carries no studyflow/);
  });
});
