import { useMemo } from 'react';
import { settingsView as s } from '../../styles';
import { useSettings } from '../useSettings';
import { clearAllLocalData, getStorageEstimate } from '../store';
import { Row, SectionHeader, ToggleControl } from './controls';

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

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}
