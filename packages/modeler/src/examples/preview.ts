import { Study, renderSvg } from '@canvas/index.ts';
import type { StudyModel } from '@core/model/index';
import { resolveIcon } from '@modeler/draw/icons';

/**
 * A YAML example's card picture as SVG: what the diagram shows, its glyphs inlined as the canvas draws them, so a
 * task's type and a gateway's kind read on the card. The study drafts a drawing into `model` when it holds none.
 */
export function drawPreview(model: StudyModel): string {
  return renderSvg(Study.of(model), { iconResolver: resolveIcon });
}
