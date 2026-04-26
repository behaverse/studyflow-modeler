import type { PaletteEntry, PaletteGroup } from '../../constants/palette';
import type { PaletteDragHandlers } from '../hooks/usePaletteDrag';

type Props = {
  group: PaletteGroup;
  extraItems: PaletteEntry[];
  isOpen: boolean;
  handlers: PaletteDragHandlers;
};

/** Flyout panel rendered next to a palette group button. */
export function Popup({ group, extraItems, isOpen, handlers }: Props) {
  return (
    <div
      className={`${isOpen ? 'visible opacity-100 pointer-events-auto' : 'invisible opacity-0 pointer-events-none'}
                  group-hover/palgroup:visible group-hover/palgroup:opacity-100 group-hover/palgroup:pointer-events-auto
                  transition-all duration-150
                  absolute left-[calc(100%+10px)] top-[-6px] z-[300]
                  w-[220px] p-2.5 pb-3
                  rounded-[14px] bg-[#ece5d0]/95 backdrop-blur-2xl
                  border border-[#b0a993]/40
                  shadow-[0_4px_12px_rgba(0,0,0,0.10),0_8px_32px_rgba(0,0,0,0.12),inset_0_1px_0_rgba(255,255,255,0.6)]`}>
      {/* Gap bridge so hover stays active between button and flyout */}
      <span className="absolute left-[-10px] top-0 w-[10px] h-full" aria-hidden="true" />

      <div className="text-[10px] font-bold uppercase tracking-[0.1em] text-stone-500
                      pb-2 mb-2 px-1 border-b border-[#b0a993]/40">
        {group.label}
      </div>
      <div className="grid grid-cols-3 gap-1">
        {[...group.items, ...extraItems].map((item) => {
          const key = item.studyflowType ?? item.bpmnType;
          const isUrlIcon = !!item.icon && /^(https?:\/\/|data:image\/)/i.test(item.icon);
          return (
            <button
              key={key}
              type="button"
              title={`Create ${item.label}`}
              className="flex flex-col items-center justify-center gap-1 p-2 rounded-lg
                         text-stone-700 hover:text-violet-700 hover:bg-[#b0a993]/25
                         transition-colors cursor-grab active:cursor-grabbing"
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
              <span className="text-[9.5px] font-semibold leading-tight text-center">
                {item.label}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
