/**
 * A template's picture for the Add panel's Templates view: what it drops, drawn as the New dialog draws a study (the
 * canvas's own drawing, its glyphs inlined). A template that drops a container shows its inside; one that drops a pool, or
 * a single shape, shows that. Drawn once per template, as an image the panel shows, and kept for the session: turning
 * a skill off reloads the app.
 */

import { Study, renderSvg } from '@canvas/index.ts';
import { isExpandable } from '@core/document/outline';
import { StudyModel } from '@core/model/index';
import type { Metamodel } from '@core/model/metamodel';
import { readStudy } from '@core/model/yaml';
import { resolveIcon } from '@modeler/draw/icons';

/** A study with nothing in it, to drop each template into. */
const EMPTY = 'id: template-picture\nschemas: {}\nStudy_1:\n  type: Process\n';

const pictures = new Map<string, string | undefined>();

function draw(template: string, metamodel: Metamodel): string | undefined {
  const study = Study.of(new StudyModel(readStudy(EMPTY, metamodel, () => {}), metamodel));
  const made = study.add({ template, at: { x: 0, y: 0 } });
  const record = made.id === undefined ? undefined : study.get(made.id);
  if (!made.ok || record?.kind !== 'node') return undefined;
  const svg = renderSvg(study, { iconResolver: resolveIcon, ...(isExpandable(record.type) ? { scope: record.id } : {}) });
  return URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }));
}

/** The picture of `template` as an image URL, or nothing when it cannot be drawn. */
export function templatePicture(template: string, metamodel: Metamodel): string | undefined {
  if (!pictures.has(template)) {
    try {
      pictures.set(template, draw(template, metamodel));
    } catch (err) {
      console.warn(`The template ${template} could not be drawn:`, err);
      pictures.set(template, undefined);
    }
  }
  return pictures.get(template);
}
