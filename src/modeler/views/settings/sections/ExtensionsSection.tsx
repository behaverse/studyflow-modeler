import { useMemo } from 'react';
import { SCHEMAS } from '@/modeler/infra/constants';
import { settingsView as s } from '@/modeler/infra/styles';
import { useSettings } from '@/modeler/views/settings/useSettings';
import { Row, SectionHeader, ToggleControl } from '@/modeler/views/settings/sections/controls';
import { ICONS } from '@/icons';

export function ExtensionsSection() {
  const { settings, update } = useSettings();
  const enabled = useMemo(() => new Set(settings.enabledSchemas), [settings.enabledSchemas]);
  const initial = useMemo(() => new Set(settings.enabledSchemas), []);
  const dirty = useMemo(() => {
    if (initial.size !== enabled.size) return true;
    for (const id of initial) if (!enabled.has(id)) return true;
    return false;
  }, [enabled, initial]);

  function toggle(prefix: string, on: boolean) {
    const schema = SCHEMAS.find((sc) => sc.prefix === prefix);
    if (schema?.core && !on) return; // core schemas can't be disabled
    const next = new Set(enabled);
    if (on) next.add(prefix);
    else next.delete(prefix);
    for (const sc of SCHEMAS) if (sc.core) next.add(sc.prefix); // core always included
    update({ enabledSchemas: SCHEMAS.map((sc) => sc.prefix).filter((p) => next.has(p)) });
  }

  return (
    <>
      <SectionHeader
        title="Extensions"
        description="Choose which extension the modeler loads. Disabled schemas are excluded from the palette and won't be recognized when opening diagrams."
      />

      {dirty && (
        <div className={s.group}>
          <p className={s.rowHelp}>
            <i className={`${ICONS.arrowClockwise} pe-1.5`} /> Reload the page to apply changes.
            <button
              type="button"
              className={`ms-2 ${s.inlineBtn}`}
              onClick={() => window.location.reload()}
            >
              Reload now
            </button>
          </p>
        </div>
      )}

      {SCHEMAS.map((schema) => (
        <Row
          key={schema.prefix}
          label={schema.core ? `${schema.name} (core)` : schema.name}
          help={schema.core ? `${schema.description} Core schemas cannot be disabled.` : schema.description}
          control={
            <ToggleControl
              label={`Enable ${schema.name} schema`}
              checked={schema.core || enabled.has(schema.prefix)}
              onChange={(on) => toggle(schema.prefix, on)}
              disabled={schema.core}
            />
          }
        />
      ))}
    </>
  );
}
