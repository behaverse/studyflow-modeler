import { expect, test } from '@playwright/test';

import { Study } from '@canvas/index.ts';
import { xmlToStudy } from '@core/document';
import type { StudyModel } from '@core/model/index';
import { studyText } from '@core/model/yaml';
import type { Editor } from '@modeler/editor/port';
import { readTrail, resetTrailStamping, stampTrailForExport, trailTimestamp } from '@modeler/provenance/trail';
import { freshMetamodel } from './schemas';
import { exampleXml } from './utils';

/** Run records in `state._meta.prov`, stamped once per *fact* so re-rendering stays byte-stable. */

/** Shipped examples may already carry a trail (rendering stamps them); build premises from one with none. */
async function untrailed(name: string): Promise<StudyModel> {
  const model = await xmlToStudy(await exampleXml(name), freshMetamodel());
  delete (model.study.state?._meta as { prov?: unknown } | undefined)?.prov;
  return model;
}

test.describe('provenance trail', () => {
  test('a stamp joins the step it follows, so a save is no undo step of its own: one undo takes back the edit and its stamp', async () => {
    const model = await untrailed('drawn_loop');
    const study = await Study.open(studyText(model.study, model.metamodel), { metamodel: freshMetamodel() });
    const modeler = { study, revision: () => study.revision } as unknown as Editor;
    // Saved as opened: the stamp is part of the load, nothing to undo.
    expect(stampTrailForExport(modeler, { tool: 'studyflow-modeler/test' })?.action).toBe('created');
    expect([readTrail(study.model).length, study.canUndo]).toEqual([1, false]);
    study.rename({ id: 'Say', name: 'Say it once' });
    expect(stampTrailForExport(modeler, { tool: 'studyflow-modeler/test' })?.action).toBe('modified');
    study.undo();
    expect([readTrail(study.model).length, study.model.get('Say')?.name]).toEqual([1, 'Say it again']);
    study.redo();
    expect([readTrail(study.model).length, study.model.get('Say')?.name]).toEqual([2, 'Say it once']);
  });

  test('stamps once per fact, not once per download', async () => {
    const model = await untrailed('drawn_loop');
    // A partial mock: stamping reads the study model, and decides off the study's revision counter, one bump per
    // change. `edit()` is that bump.
    let revision = 0;
    const modeler = {
      revision: () => revision,
      study: {
        root: { id: 'Root' },
        model,
        amend: (_id: string, write: (element: unknown, model: StudyModel) => void) => { write(model.primaryRoot(), model); revision += 1; return { ok: true }; },
      },
    } as unknown as Editor;
    const edit = () => { revision += 1; };

    expect(stampTrailForExport(modeler, { tool: 'studyflow-modeler/test' })?.action).toBe('created');
    expect(readTrail(model)).toHaveLength(1);
    // The stamp is written in the machine's own timezone: an instant with its offset, not one rendering.
    expect(readTrail(model)[0].when).toMatch(/(?:Z|[+-]\d{2}:\d{2})$/);
    expect(Date.parse(trailTimestamp(new Date('2026-07-31T10:00:00Z')))).toBe(Date.parse('2026-07-31T10:00:00Z'));

    expect(stampTrailForExport(modeler, { tool: 'studyflow-modeler/test' })).toBeUndefined();
    expect(readTrail(model)).toHaveLength(1);

    edit();
    expect(stampTrailForExport(modeler, { tool: 'studyflow-modeler/test' })?.action).toBe('modified');
    expect(readTrail(model)).toHaveLength(2);
    expect(stampTrailForExport(modeler, { tool: 'studyflow-modeler/test' })).toBeUndefined();

    // Reopened: the import moves the revision, and the baseline with it, so a trail-carrying document nobody edits is left untouched.
    edit();
    resetTrailStamping(modeler);
    expect(stampTrailForExport(modeler, { tool: 'studyflow-modeler/test' })).toBeUndefined();
    expect(readTrail(model)).toHaveLength(2);
  });
});
