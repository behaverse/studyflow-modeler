import { useEffect, useRef, useState } from 'react';
import { executeCommand } from '../../commands';
import type { PaletteSchemaDescriptor } from '../../commands/palette/paletteSetup';

/**
 * Subscribe to schema-contributed palette entries.
 *
 * On every modeler change, dispatches `palette-register-schema-providers`
 * and exposes the resolved schemas.
 */
export function useSchemaProviders(modeler: any): PaletteSchemaDescriptor[] {
  const [schemas, setSchemas] = useState<PaletteSchemaDescriptor[]>([]);
  const lastModelerRef = useRef<any>(null);

  useEffect(() => {
    if (!modeler) return;
    let isCancelled = false;

    if (lastModelerRef.current !== modeler) {
      lastModelerRef.current = modeler;
    }

    executeCommand(modeler, {
      type: 'palette-register-schema-providers',
    })
      .then((nextSchemas: PaletteSchemaDescriptor[]) => {
        if (!isCancelled) setSchemas(nextSchemas);
      })
      .catch(() => {
        if (!isCancelled) setSchemas([]);
      });

    return () => {
      isCancelled = true;
    };
  }, [modeler]);

  return schemas;
}
