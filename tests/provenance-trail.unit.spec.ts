import { expect, test } from '@playwright/test';

import { primaryRoot, readState, writeState } from '@core/document';
import { readTrail, resetTrailStamping, stampTrailForExport, trailTimestamp } from '@modeler/provenance/trail';
import { freshModdle } from './schemas';
import { exampleXml } from './utils';
import type { Editor } from '@modeler/editor/port';

/** Run records in `state._meta.prov`, stamped once per *fact* so re-rendering stays byte-stable. */

const moddle = freshModdle();

async function definitionsOf(xml: string): Promise<any> {
  const { rootElement } = await moddle.fromXML(xml);
  return rootElement;
}

/** Shipped examples may already carry a trail (rendering stamps them); build premises from one with none. */
function stripTrail(definitions: any): any {
  const root = primaryRoot(definitions)!;
  const ext = root.extensionElements;
  if (ext) ext.values = ext.values.filter((value: any) => value.$type !== 'prov:Activity');
  const tree = readState(definitions);
  delete tree._meta?.prov;
  writeState(definitions, moddle, tree);
  return definitions;
}

test.describe('provenance trail', () => {
  test('stamps once per fact, not once per download', async () => {
    const definitions = stripTrail(await definitionsOf(await exampleXml('drawn_loop')));
    // A partial mock: stamping reads the document and `moddle`, and decides off the
    // revision counter `editor/history.ts` serves, one bump per applied mutation.
    // `edit()` is that bump.
    let revision = 0;
    const modeler = {
      getDefinitions: () => definitions,
      revision: () => revision,
      model: { moddle: () => moddle },
    } as unknown as Editor;
    const edit = () => { revision += 1; };

    expect(stampTrailForExport(modeler, { tool: 'studyflow-modeler/test' })?.action).toBe('created');
    expect(readTrail(definitions)).toHaveLength(1);
    // The stamp is written in the machine's own timezone: an instant with its offset, not one rendering.
    expect(readTrail(definitions)[0].when).toMatch(/(?:Z|[+-]\d{2}:\d{2})$/);
    expect(Date.parse(trailTimestamp(new Date('2026-07-31T10:00:00Z')))).toBe(Date.parse('2026-07-31T10:00:00Z'));

    expect(stampTrailForExport(modeler, { tool: 'studyflow-modeler/test' })).toBeUndefined();
    expect(readTrail(definitions)).toHaveLength(1);

    edit();
    expect(stampTrailForExport(modeler, { tool: 'studyflow-modeler/test' })?.action).toBe('modified');
    expect(readTrail(definitions)).toHaveLength(2);
    expect(stampTrailForExport(modeler, { tool: 'studyflow-modeler/test' })).toBeUndefined();

    // Reopened (import resets the edit history without moving the revision): a trail-carrying document nobody edits is left untouched.
    resetTrailStamping(modeler);
    expect(stampTrailForExport(modeler, { tool: 'studyflow-modeler/test' })).toBeUndefined();
    expect(readTrail(definitions)).toHaveLength(2);
  });
});
