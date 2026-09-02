import { useLayoutEffect, useRef } from 'react';
import {
  getPaletteIconForBpmnType,
  type PaletteEntry,
  type PaletteGroup,
} from '@modeler/palette/groups';
import type { PaletteSchema } from '@modeler/palette/commands';
import type { PaletteDraggable, PaletteDragHandlers } from '@modeler/palette/usePaletteDrag';
import { paletteFlyout } from '@modeler/palette/styles';
import { PaletteIcon } from '@modeler/palette/PaletteIcon';

/* Positions imperatively: React state would bail out on an unchanged offset and leave the cleared transform behind on re-opens. */
function useFlyoutPosition(isOpen: boolean) {
  const ref = useRef<HTMLDivElement | null>(null);

  useLayoutEffect(() => {
    if (!isOpen) return;
    const el = ref.current;
    if (!el) return;

    const measure = () => {
      el.style.transform = '';
      const rect = el.getBoundingClientRect();
      const margin = 12;
      const overflowBottom = rect.bottom - (window.innerHeight - margin);
      const shift = Math.min(Math.max(overflowBottom, 0), Math.max(rect.top - margin, 0));
      el.style.transform = shift ? `translateY(${-shift}px)` : '';
    };

    measure();
    const onResize = () => measure();
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [isOpen]);

  return { ref };
}

type TileProps = {
  draggable: PaletteDraggable;
  icon: string | undefined;
  title: string;
  label: string;
  handlers: PaletteDragHandlers;
};

function PaletteTile({ draggable, icon, title, label, handlers }: TileProps) {
  return (
    <button
      type="button"
      title={title}
      className={paletteFlyout.item}
      onPointerDown={(e) => handlers.onPointerDown(draggable, e)}
      onPointerMove={(e) => handlers.onPointerMove(draggable, e)}
      onPointerUp={handlers.onPointerUp}
      onPointerLeave={handlers.onPointerUp}
      onPointerCancel={handlers.onPointerUp}
      onClick={(e) => handlers.onClick(draggable, e)}
    >
      <PaletteIcon icon={icon} size={22} />
      <span className={paletteFlyout.itemLabel}>{label}</span>
    </button>
  );
}

type PopupProps = {
  group: PaletteGroup;
  extraItems: PaletteEntry[];
  isOpen: boolean;
  handlers: PaletteDragHandlers;
};

export function Popup({ group, extraItems, isOpen, handlers }: PopupProps) {
  const { ref } = useFlyoutPosition(isOpen);
  return (
    <div ref={ref} className={paletteFlyout.panel(isOpen)}>
      <span className={paletteFlyout.gapBridge} aria-hidden="true" />

      <div className={paletteFlyout.header}>{group.label}</div>

      <div className={paletteFlyout.grid}>
        {[...group.items, ...extraItems].map((item) => (
          <PaletteTile
            key={item.label}
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

type SchemaPopupProps = {
  schema: PaletteSchema;
  isOpen: boolean;
  handlers: PaletteDragHandlers;
};

export function SchemaPopup({ schema, isOpen, handlers }: SchemaPopupProps) {
  const { ref } = useFlyoutPosition(isOpen);

  return (
    <div ref={ref} className={paletteFlyout.panel(isOpen)}>
      <span className={paletteFlyout.gapBridge} aria-hidden="true" />

      <div className={`${paletteFlyout.header} flex items-center gap-1.5`}>
        <PaletteIcon icon={schema.icon} size={14} />
        <span>{schema.name}</span>
        {!schema.core && (
          <span
            className={`${paletteFlyout.extBadge} ml-auto`}
            title="Optional element set. Turn it off in Settings > Extensions."
          >
            ext
          </span>
        )}
      </div>

      {schema.items.length > 0 && (
        <div className={paletteFlyout.grid}>
          {schema.items.map((item) => (
            <PaletteTile
              key={`type-${item.extensionType}`}
              draggable={item}
              icon={item.icon ?? getPaletteIconForBpmnType(item.bpmnType) ?? schema.icon}
              title={`Create ${item.label}`}
              label={item.label}
              handlers={handlers}
            />
          ))}
        </div>
      )}

      {schema.templates.length > 0 && (
        <>
          <div className={paletteFlyout.sectionHeader}>Templates</div>
          <div className={paletteFlyout.grid}>
            {schema.templates.map((template) => {
              const typeIcon = schema.items.find((it) => it.extensionType === template.extensionType)?.icon;
              return (
                <PaletteTile
                  key={`template-${template.id}`}
                  draggable={{ ...template, __template: true }}
                  icon={template.icon ?? typeIcon ?? schema.icon ?? getPaletteIconForBpmnType(template.bpmnType)}
                  title={template.description ? `${template.label}: ${template.description}` : `Create ${template.label}`}
                  label={template.label}
                  handlers={handlers}
                />
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}
