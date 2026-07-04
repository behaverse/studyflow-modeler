import { Switch } from '@headlessui/react';
import { settingsView as s } from '../../styles';

/** Shared building blocks for the settings sections. */

export function SectionHeader({ title, description }: { title: string; description?: string }) {
  return (
    <div>
      <h2 className={s.sectionTitle}>{title}</h2>
      {description && <p className={s.sectionDescription}>{description}</p>}
    </div>
  );
}

export function Row({
  label,
  help,
  control,
}: {
  label: string;
  help?: React.ReactNode;
  control: React.ReactNode;
}) {
  return (
    <div className={s.row}>
      <div className={s.rowText}>
        <div className={s.rowLabel}>{label}</div>
        {help && <p className={s.rowHelp}>{help}</p>}
      </div>
      <div className={s.rowControl}>{control}</div>
    </div>
  );
}

export function ToggleControl({
  checked,
  onChange,
  label,
  disabled,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  label: string;
  disabled?: boolean;
}) {
  return (
    <Switch
      checked={checked}
      onChange={onChange}
      disabled={disabled}
      aria-label={label}
      className={`group ${s.switchTrack} ${disabled ? 'opacity-50 cursor-not-allowed' : ''}`}
    >
      <span aria-hidden="true" className={s.switchThumb} />
    </Switch>
  );
}

export function SelectControl<T extends string>({
  value,
  options,
  onChange,
  label,
}: {
  value: T;
  options: { value: T; label: string }[];
  onChange: (next: T) => void;
  label: string;
}) {
  return (
    <div className={s.selectWrapper}>
      <select
        value={value}
        aria-label={label}
        onChange={(e) => onChange(e.target.value as T)}
        className={s.select}
      >
        {options.map((opt) => (
          <option key={opt.value} value={opt.value}>
            {opt.label}
          </option>
        ))}
      </select>
      <i className={s.selectChevron} aria-hidden="true" />
    </div>
  );
}
