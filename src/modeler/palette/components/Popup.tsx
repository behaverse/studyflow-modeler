import type { PaletteEntry, PaletteGroup } from '../../constants/palette';
import type { PaletteDragHandlers } from '../hooks/usePaletteDrag';
import { paletteFlyout } from '../../styles';

type Props = {
  group: PaletteGroup;
  extraItems: PaletteEntry[];
  isOpen: boolean;
  handlers: PaletteDragHandlers;
};

/** Flyout panel rendered next to a palette group button. */
export function Popup({ group, extraItems, isOpen, handlers }: Props) {
  return (
    <div className={paletteFlyout.panel(isOpen)}>
      {/* Gap bridge so hover stays active between button and flyout */}
      <span className={paletteFlyout.gapBridge} aria-hidden="true" />

      <div className={paletteFlyout.header}>
        {group.label}
      </div>
      <div className={paletteFlyout.grid}>
        {[...group.items, ...extraItems].map((item) => {
          const key = item.studyflowType ?? item.bpmnType;
          const isUrlIcon = !!item.icon && /^(https?:\/\/|data:image\/)/i.test(item.icon);
          return (
            <button
              key={key}
              type="button"
              title={`Create ${item.label}`}
              className={paletteFlyout.item}
              onMouseDown={(e) => handlers.onMouseDown(item, e)}
              onMouseMove={(e) => handlers.onMouseMove(item, e)}
              onMouseUp={handlers.onMouseUp}
              onMouseLeave={handlers.onMouseUp}
              onClick={(e) => handlers.onClick(item, e)}
            >
              {isUrlIcon ? (
                <img src={item.icon} alt="" className="h-[22px] w-[22px] object-contain" loading="lazy" decoding="async" />
              ) : (
                <i className={`text-[22px] ${item.icon || 'iconify tabler--hexagon'}`}></i>
              )}
              <span className={paletteFlyout.itemLabel}>
                {item.label}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
