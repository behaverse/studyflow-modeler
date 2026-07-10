import type { PaletteSchema } from '@/modeler/controllers/palette/paletteSetup';
import type { PaletteDragHandlers } from '@/modeler/views/palette/hooks/usePaletteDrag';
import { useFlyoutPosition } from '@/modeler/views/palette/hooks/useFlyoutPosition';
import { getPaletteIconForBpmnType } from '@/modeler/infra/constants';
import { paletteFlyout } from '@/modeler/infra/styles';
import { PaletteIcon } from '@/modeler/views/palette/components/PaletteIcon';
import { PaletteTile } from '@/modeler/views/palette/components/PaletteTile';

type Props = {
  schema: PaletteSchema;
  isOpen: boolean;
  handlers: PaletteDragHandlers;
};

/** Flyout panel rendered next to a schema "More..." palette button. */
export function SchemaPopup({ schema, isOpen, handlers }: Props) {
  const { ref, style } = useFlyoutPosition(isOpen);

  return (
    <div ref={ref} style={style} className={paletteFlyout.panel(isOpen)}>
      {/* Gap bridge so hover stays active between button and flyout */}
      <span className={paletteFlyout.gapBridge} aria-hidden="true" />

      <div className={`${paletteFlyout.header} flex items-center gap-1.5`}>
        <PaletteIcon icon={schema.icon} size={14} />
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
