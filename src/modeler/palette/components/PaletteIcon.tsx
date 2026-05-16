// Renders a palette icon: <img> for url/data icons, otherwise an iconify <i>.

type Props = {
  icon?: string;
  size: number;
};

function isImageIcon(icon: string): boolean {
  return /^(https?:\/\/|data:image\/)/i.test(icon);
}

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
