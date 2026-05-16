import { field as s } from '../styles';

/** Help-icon tooltip next to a field label; `wide` is used for longer descriptions. */
export function HelpTooltip({
  name,
  description,
  wide = true,
}: {
  name: string;
  description?: string;
  wide?: boolean;
}) {
  return (
    <div className={s.helpAnchor}>
      <i className={s.helpIcon}></i>
      <div className={wide ? s.helpTooltipWide : s.helpTooltip}>
        <pre className={s.helpTooltipName}>{name}</pre>
        {description}
      </div>
    </div>
  );
}
