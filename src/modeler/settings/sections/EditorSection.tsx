import { useSettings } from '../useSettings';
import { Row, SectionHeader, SelectControl, ToggleControl } from './controls';

export function EditorSection() {
  const { settings, update } = useSettings();

  return (
    <>
      <SectionHeader title="Editor" description="How the canvas and inspector behave." />

      <Row
        label="Show grid"
        help="Render a faint background grid on the canvas."
        control={
          <ToggleControl
            label="Show grid"
            checked={settings.showGrid}
            onChange={(showGrid) => update({ showGrid })}
          />
        }
      />

      <Row
        label="Auto-save diagram"
        help="Save the current diagram to this browser as you edit, so it persists across reloads."
        control={
          <SelectControl
            label="Auto-save"
            value={settings.diagramAutoSave}
            onChange={(diagramAutoSave) => update({ diagramAutoSave })}
            options={[
              { value: 'off', label: 'Off' },
              { value: 'local', label: 'On (this browser)' },
            ]}
          />
        }
      />
    </>
  );
}
