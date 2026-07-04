import { useSettings } from '../useSettings';
import { Row, SectionHeader, SelectControl } from './controls';

export function GeneralSection() {
  const { settings, update } = useSettings();

  return (
    <>
      <SectionHeader title="General" description="Appearance and language preferences." />

      <Row
        label="Theme"
        control={
          <SelectControl
            label="Theme"
            value={settings.theme}
            onChange={(theme) => update({ theme })}
            options={[
              { value: 'light', label: 'Light' },
            ]}
          />
        }
      />

      <Row
        label="Language"
        control={
          <SelectControl
            label="Language"
            value={settings.language}
            onChange={(language) => update({ language })}
            options={[{ value: 'en', label: 'English' }]}
          />
        }
      />
    </>
  );
}
