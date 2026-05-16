import { field as s } from '../styles';

/** 14x14 check-mark SVG for Headless UI's Checkbox. */
export function CheckIcon() {
  return (
    <svg className={s.checkboxIcon} viewBox="0 0 14 14" fill="none">
      <path d="M3 8L6 11L11 3.5" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
