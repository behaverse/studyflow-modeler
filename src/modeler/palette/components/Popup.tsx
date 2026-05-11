import type { PaletteEntry, PaletteGroup } from '../../constants';
import { getPaletteIconForBpmnType } from '../../constants';
import type { PaletteDragHandlers } from '../hooks/usePaletteDrag';
import { useFlyoutPosition } from '../hooks/useFlyoutPosition';
import { paletteFlyout } from '../../styles';

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

      <div className={paletteFlyout.header}>
        {group.label}
      </div>
      <div className={paletteFlyout.grid}>
        {[...group.items, ...extraItems].map((item) => {
          const key = item.studyflowType ?? item.bpmnType;
          const resolvedIcon = item.icon ?? getPaletteIconForBpmnType(item.bpmnType) ?? group.icon;
          const isUrlIcon = !!resolvedIcon && /^(https?:\/\/|data:image\/)/i.test(resolvedIcon);
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
                <img src={resolvedIcon} alt="" className="h-[22px] w-[22px] object-contain" loading="lazy" decoding="async" />
              ) : (
                <i className={`text-[22px] ${resolvedIcon}`}></i>
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
