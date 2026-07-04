import { useMemo } from 'react';
import { settingsView as s } from '@/modeler/infra/styles';
import { useSettings } from '@/modeler/views/settings/useSettings';
import { clearAllLocalData, getStorageEstimate } from '@/modeler/infra/settings/store';
import { Row, SectionHeader, ToggleControl } from '@/modeler/views/settings/sections/controls';
import { formatBytes } from '@/modeler/models/format';

export function PrivacySection() {
  const { settings, update, reset } = useSettings();
  const estimate = useMemo(() => getStorageEstimate(), []);

  return (
    <>
      <SectionHeader
        title="Privacy"
        description="Everything is stored in your browser, and nothing leaves this device unless you sign in and publish."
      />

      <Row
        label="Anonymous telemetry"
        help="Send anonymous error and usage data to help improve the modeler. Off by default."
        control={
          <ToggleControl
            label="Anonymous telemetry"
            checked={settings.telemetryEnabled}
            onChange={(telemetryEnabled) => update({ telemetryEnabled })}
          />
        }
      />

      <Row
        label="Local storage"
        help={`${estimate.keys} key${estimate.keys === 1 ? '' : 's'}, ~${formatBytes(estimate.bytes)}`}
        control={
          <button
            type="button"
            className={s.inlineBtnDanger}
            onClick={() => {
              if (window.confirm('Clear all local data including settings and saved diagrams? This cannot be undone.')) {
                clearAllLocalData();
              }
            }}
          >
            Clear all local data
          </button>
        }
      />

      <Row
        label="Reset settings"
        help="Restore every setting on this page to its default. Saved diagrams are not affected."
        control={
          <button type="button" className={s.inlineBtn} onClick={reset}>
            Reset to defaults
          </button>
        }
      />
    </>
  );
}
