import { useLayoutEffect, useRef, useState } from 'react';
import {
  getPaletteIconForBpmnType,
  type PaletteEntry,
  type PaletteGroup,
} from '@modeler/palette/groups';
import type { PaletteSchema } from '@modeler/palette/commands';
import type { PaletteDraggable, PaletteDragHandlers } from '@modeler/palette/usePaletteDrag';
import { paletteFlyout } from '@modeler/palette/styles';
import { PaletteIcon } from '@modeler/palette/PaletteIcon';

function useFlyoutPosition(isOpen: boolean) {
  const ref = useRef<HTMLDivElement | null>(null);
  const [offset, setOffset] = useState(0);

  useLayoutEffect(() => {
    if (!isOpen) return;
    const el = ref.current;
    if (!el) return;

    const measure = () => {
      el.style.transform = '';
      const rect = el.getBoundingClientRect();
      const margin = 12;
      const overflowBottom = rect.bottom - (window.innerHeight - margin);
      if (overflowBottom <= 0) {
        setOffset(0);
        return;
      }
      const maxShift = rect.top - margin;
      setOffset(-Math.min(overflowBottom, Math.max(maxShift, 0)));
    };

    measure();
    const onResize = () => measure();
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [isOpen]);

  return {
    ref,
    style: isOpen && offset ? { transform: `translateY(${offset}px)` } : undefined,
  };
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

type PopupProps = {
  group: PaletteGroup;
  extraItems: PaletteEntry[];
  isOpen: boolean;
  handlers: PaletteDragHandlers;
};

export function Popup({ group, extraItems, isOpen, handlers }: PopupProps) {
  const { ref, style } = useFlyoutPosition(isOpen);
  return (
    <div ref={ref} style={style} className={paletteFlyout.panel(isOpen)}>
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

type SchemaPopupProps = {
  schema: PaletteSchema;
  isOpen: boolean;
  handlers: PaletteDragHandlers;
};

export function SchemaPopup({ schema, isOpen, handlers }: SchemaPopupProps) {
  const { ref, style } = useFlyoutPosition(isOpen);

  return (
    <div ref={ref} style={style} className={paletteFlyout.panel(isOpen)}>
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
