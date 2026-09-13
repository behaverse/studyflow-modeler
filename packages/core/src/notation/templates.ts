import { longTypeName } from '@core/document/shorthand';
import type { TypeCatalog } from '@core/notation/query';
import type { SchemaModel } from '@core/notation/moddlePackage';
import type { Template } from '@core/notation/types';

type Mapping = Record<string, unknown>;

const isMapping = (value: unknown): value is Mapping => !!value && typeof value === 'object' && !Array.isArray(value);

/** What the palette shows of each template, read off its first element; the modeler builds the elements on drop. */
export function compileTemplates(prefix: string, model: SchemaModel, catalog: TypeCatalog): Template[] {
  const templates: Template[] = [];

  for (const [index, template] of (model?.templates ?? []).entries()) {
    const elements = isMapping(template?.elements) ? template.elements : {};
    const [id, root] = Object.entries(elements)[0] ?? [];
    if (!isMapping(root) || typeof root.type !== 'string') {
      catalog.diagnostics.push(`[${prefix} template:${index + 1}] its first element has no \`type\`; skipped`);
      continue;
    }

    // Read in the short spelling only: `extensionElements` as a list of typed entries.
    const extension = (Array.isArray(root.extensionElements) ? root.extensionElements : [])
      .find((entry): entry is Mapping => isMapping(entry) && !!catalog.getType(String(entry.type)));
    const extensionType = extension ? String(extension.type) : undefined;
    // The element's own `studyflow:icon`, read where the canvas reads it, on the extension entry of a typed element.
    const ownIcon = (extension ?? root).icon;

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
