import type { ReactNode } from 'react';
import type {
  PaletteSchemaDescriptor,
  PaletteSchemaItem,
  PaletteSchemaTemplate,
} from '../../commands/palette/paletteSetup';
import type { PaletteDraggable, PaletteDragHandlers } from '../hooks/usePaletteDrag';
import { useFlyoutPosition } from '../hooks/useFlyoutPosition';
import { getPaletteIconForBpmnType } from '../../constants';
import { paletteFlyout } from '../../styles';

type Props = {
  schema: PaletteSchemaDescriptor;
  isOpen: boolean;
  handlers: PaletteDragHandlers;
};

function isUrlIcon(icon?: string): boolean {
  return !!icon && /^(https?:\/\/|data:image\/)/i.test(icon);
}

function renderTileIcon(icon?: string): ReactNode {
  if (isUrlIcon(icon)) {
    return (
      <img
        src={icon}
        alt=""
        className="h-[22px] w-[22px] object-contain"
        loading="lazy"
        decoding="async"
      />
    );
  }
  return <i className={`text-[22px] ${icon}`}></i>;
}

function renderHeaderIcon(icon?: string): ReactNode {
  if (isUrlIcon(icon)) {
    return (
      <img
        src={icon}
        alt=""
        className="h-4 w-4 object-contain"
        loading="lazy"
        decoding="async"
      />
    );
  }
  if (icon) {
    return <i className={`text-[14px] ${icon}`}></i>;
  }
  return null;
}

/** Flyout panel rendered next to a schema "More..." palette button. */
export function SchemaPopup({ schema, isOpen, handlers }: Props) {
  const hasItems = schema.items.length > 0;
  const hasTemplates = schema.templates.length > 0;
  const { ref, style } = useFlyoutPosition(isOpen);

  return (
    <div ref={ref} style={style} className={paletteFlyout.panel(isOpen)}>
      {/* Gap bridge so hover stays active between button and flyout */}
      <span className={paletteFlyout.gapBridge} aria-hidden="true" />

      <div className={`${paletteFlyout.header} flex items-center gap-1.5`}>
        {renderHeaderIcon(schema.icon)}
        <span>{schema.name}</span>
        {!schema.core && (
          <span
            className={`${paletteFlyout.extBadge} ml-auto`}
            title="Third-party extension schema"
          >
            ext
          </span>
        )}
      </div>

      {hasItems && (
        <>
          <div className={paletteFlyout.grid}>
            {schema.items.map((item: PaletteSchemaItem) => {
              const draggable: PaletteDraggable = item;
              const resolvedIcon = item.icon ?? getPaletteIconForBpmnType(item.bpmnType) ?? schema.icon;
              return (
                <button
                  key={`type-${item.studyflowType}`}
                  type="button"
                  title={`Create ${item.label}`}
                  className={paletteFlyout.item}
                  onMouseDown={(e) => handlers.onMouseDown(draggable, e)}
                  onMouseMove={(e) => handlers.onMouseMove(draggable, e)}
                  onMouseUp={handlers.onMouseUp}
                  onMouseLeave={handlers.onMouseUp}
                  onClick={(e) => handlers.onClick(draggable, e)}
                >
                  {renderTileIcon(resolvedIcon)}
                  <span className={paletteFlyout.itemLabel}>{item.label}</span>
                </button>
              );
            })}
          </div>
        </>
      )}

      {hasTemplates && (
        <>
          <div className={paletteFlyout.sectionHeader}>Templates</div>
          <div className={paletteFlyout.grid}>
            {schema.templates.map((template: PaletteSchemaTemplate) => {
              const draggable: PaletteDraggable = { ...template, __template: true };
              const typeIcon = schema.items.find((it) => it.studyflowType === template.studyflowType)?.icon;
              const resolvedIcon = template.icon ?? typeIcon ?? schema.icon ?? getPaletteIconForBpmnType(template.bpmnType);
              return (
                <button
                  key={`template-${template.id}`}
                  type="button"
                  title={template.description ? `${template.label}: ${template.description}` : `Create ${template.label}`}
                  className={paletteFlyout.item}
                  onMouseDown={(e) => handlers.onMouseDown(draggable, e)}
                  onMouseMove={(e) => handlers.onMouseMove(draggable, e)}
                  onMouseUp={handlers.onMouseUp}
                  onMouseLeave={handlers.onMouseUp}
                  onClick={(e) => handlers.onClick(draggable, e)}
                >
                  {renderTileIcon(resolvedIcon)}
                  <span className={paletteFlyout.itemLabel}>{template.label}</span>
                </button>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}
