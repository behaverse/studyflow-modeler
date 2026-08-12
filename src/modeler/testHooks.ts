import { SCHEMAS } from '@behaverse/studyflow-core/notation/loader';
import { embedIconsInSvg, exportToPng, padSvg } from '@/modeler/export/svgEmbedding';

declare global {
  interface Window {
    __studyflowTest?: {
      embedIconsInSvg: typeof embedIconsInSvg;
      exportToPng: typeof exportToPng;
      padSvg: typeof padSvg;
      schemas: typeof SCHEMAS;
    };
  }
}

if (import.meta.env.DEV) {
  window.__studyflowTest = { embedIconsInSvg, exportToPng, padSvg, schemas: SCHEMAS };
}

export {};
