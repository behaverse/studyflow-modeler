import { SCHEMAS } from '@core/notation/loader';
import { exportToPng, padSvg } from '@modeler/export/svgEmbedding';

declare global {
  interface Window {
    __studyflowTest?: {
      exportToPng: typeof exportToPng;
      padSvg: typeof padSvg;
      schemas: typeof SCHEMAS;
    };
  }
}

if (import.meta.env.DEV) {
  window.__studyflowTest = { exportToPng, padSvg, schemas: SCHEMAS };
}

export {};
