import { longTypeName } from '@core/document/shorthand';
import type { TypeCatalog } from '@core/notation/query';
import type { SchemaModel } from '@core/notation/schemaFile';
import type { Template } from '@core/notation/types';

type Mapping = Record<string, unknown>;

const isMapping = (value: unknown): value is Mapping => !!value && typeof value === 'object' && !Array.isArray(value);

/** An icon the element carries itself (`studyflow:icon`), under any prefix, as `getRawAttribute` reads it on the canvas. */
function ownIcon(node: Mapping): string | undefined {
  const [, icon] = Object.entries(node).find(([key, value]) => key.endsWith(':icon') && typeof value === 'string') ?? [];
  return icon as string | undefined;
}

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

    templates.push({
      id: `${prefix}::template:${index + 1}`,
      name: typeof root.name === 'string' ? root.name : id,
      description: template.description,
      extensionType,
      bpmnType: longTypeName(root.type),
      iconClass: ownIcon(extension ?? root) ?? catalog.getType(extensionType)?.iconClass,
      elements,
    });
  }

  return templates;
}
