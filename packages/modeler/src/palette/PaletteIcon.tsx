import { isImageIcon } from '@core/notation';

type Props = {
  icon?: string;
  size: number;
};

export function PaletteIcon({ icon, size }: Props) {
  if (!icon) return null;
  if (isImageIcon(icon)) {
    return (
      <img
        src={icon}
        alt=""
        style={{ height: size, width: size }}
        className="object-contain"
        loading="lazy"
        decoding="async"
      />
    );
  }
  return <i className={icon} style={{ fontSize: size }} />;
}
