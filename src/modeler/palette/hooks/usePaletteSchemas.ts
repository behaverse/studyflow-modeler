import { useEffect, useState } from 'react';
import { executeCommand } from '../../commands';
import type { PaletteSchema } from '../../commands/palette/paletteSetup';

/** Available palette schemas; rebuilt via `resolve-palette-schemas` when the modeler changes. */
export function usePaletteSchemas(modeler: any): PaletteSchema[] {
  const [schemas, setSchemas] = useState<PaletteSchema[]>([]);

  useEffect(() => {
    if (!modeler) return;
    let cancelled = false;

    executeCommand(modeler, { type: 'resolve-palette-schemas' })
      .then((next: PaletteSchema[]) => {
        if (!cancelled) setSchemas(next);
      })
      .catch(() => {
        if (!cancelled) setSchemas([]);
      });

    return () => { cancelled = true; };
  }, [modeler]);

  return schemas;
}
