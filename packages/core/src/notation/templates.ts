import { longTypeName } from '@core/model/spelling';
import { isMapping } from '@core/model/types';
import type { TypeCatalog } from '@core/notation/query';
import type { SchemaModel } from '@core/notation/moddlePackage';
import type { Template } from '@core/notation/types';

/** The palette's view of each template, read off its first element; the modeler builds the elements on drop. */
export function compileTemplates(prefix: string, model: SchemaModel, catalog: TypeCatalog): Template[] {
  const templates: Template[] = [];

  for (const [index, template] of (model?.templates ?? []).entries()) {
    const elements = isMapping(template?.elements) ? template.elements : {};
    const [id, root] = Object.entries(elements)[0] ?? [];
    if (!isMapping(root) || typeof root.type !== 'string') {
      catalog.diagnostics.push(`[${prefix} template:${index + 1}] its first element has no \`type\`; skipped`);
      continue;
    }

    // The schema type that types it, in either spelling a file takes: `extensions` keyed by type, or
    // `extensionElements` as a list of typed entries.
    const keyed = isMapping(root.extensions) ? Object.keys(root.extensions) : [];
    const listed = (Array.isArray(root.extensionElements) ? root.extensionElements : []).filter(isMapping).map((entry) => String(entry.type));
    const extensionType = [...keyed, ...listed].find((type) => !!catalog.getType(type));
    // The element's own `studyflow:icon`, on the element itself, where the canvas reads it.
    const ownIcon = root.icon;

    templates.push({
      id: `${prefix}::template:${index + 1}`,
      name: typeof root.name === 'string' ? root.name : id,
      description: template.description,
      extensionType,
      bpmnType: longTypeName(root.type),
      iconClass: typeof ownIcon === 'string' ? ownIcon : catalog.getType(extensionType)?.iconClass,
      elements,
    });
  }

  return templates;
}
