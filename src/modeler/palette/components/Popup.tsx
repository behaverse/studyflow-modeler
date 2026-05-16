import type { PaletteEntry, PaletteGroup } from '../../constants';
import { getPaletteIconForBpmnType } from '../../constants';
import type { PaletteDragHandlers } from '../hooks/usePaletteDrag';
import { useFlyoutPosition } from '../hooks/useFlyoutPosition';
import { paletteFlyout } from '../../styles';
import { PaletteTile } from './PaletteTile';

type Props = {
  group: PaletteGroup;
  extraItems: PaletteEntry[];
  isOpen: boolean;
  handlers: PaletteDragHandlers;
};

/** Flyout panel rendered next to a palette group button. */
export function Popup({ group, extraItems, isOpen, handlers }: Props) {
  const { ref, style } = useFlyoutPosition(isOpen);
  return (
    <div ref={ref} style={style} className={paletteFlyout.panel(isOpen)}>
      {/* Gap bridge so hover stays active between button and flyout */}
      <span className={paletteFlyout.gapBridge} aria-hidden="true" />

      <div className={paletteFlyout.header}>{group.label}</div>

      <div className={paletteFlyout.grid}>
        {[...group.items, ...extraItems].map((item) => (
          <PaletteTile
            key={item.extensionType ?? item.bpmnType}
            draggable={item}
            icon={item.icon ?? getPaletteIconForBpmnType(item.bpmnType) ?? group.icon}
            title={`Create ${item.label}`}
            label={item.label}
            handlers={handlers}
          />
        ))}
      </div>
    </div>
  );
}
