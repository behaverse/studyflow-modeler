import { Study, renderSvg } from '@canvas/index.ts';
import type { StudyModel } from '@core/model/index';

/**
 * A YAML example's card picture as SVG: what the diagram shows, without glyphs, which is what keeps
 * the gallery fast. The study drafts a drawing into `model` when it holds none.
 */
export function drawPreview(model: StudyModel): string {
  return renderSvg(Study.of(model), { iconResolver: () => null });
}
