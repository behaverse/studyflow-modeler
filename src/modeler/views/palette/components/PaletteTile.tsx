import type { PaletteDraggable, PaletteDragHandlers } from '@/modeler/views/palette/hooks/usePaletteDrag';
import { paletteFlyout } from '@/modeler/infra/styles';
import { PaletteIcon } from '@/modeler/views/palette/components/PaletteIcon';

type Props = {
  draggable: PaletteDraggable;
  icon: string | undefined;
  title: string;
  label: string;
  handlers: PaletteDragHandlers;
};

/** One palette tile (icon + label); routes mouse events through the shared drag/click dispatcher. */
export function PaletteTile({ draggable, icon, title, label, handlers }: Props) {
  return (
    <button
      type="button"
      title={title}
      className={paletteFlyout.item}
      onMouseDown={(e) => handlers.onMouseDown(draggable, e)}
      onMouseMove={(e) => handlers.onMouseMove(draggable, e)}
      onMouseUp={handlers.onMouseUp}
      onMouseLeave={handlers.onMouseUp}
      onClick={(e) => handlers.onClick(draggable, e)}
    >
      <PaletteIcon icon={icon} size={22} />
      <span className={paletteFlyout.itemLabel}>{label}</span>
    </button>
  );
}
