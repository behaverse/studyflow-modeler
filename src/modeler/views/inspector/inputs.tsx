import type { AttributeSpec } from '@/core/catalog';
import { ChecklistInput } from '@/modeler/views/inspector/ChecklistInput';
import { StringInput } from '@/modeler/views/inspector/StringInput';
import { CodeEditor } from '@/modeler/views/inspector/CodeEditor';
import { BooleanInput } from '@/modeler/views/inspector/BooleanInput';
import { EnumInput } from '@/modeler/views/inspector/EnumInput';
import { ArrayInput } from '@/modeler/views/inspector/ArrayInput';
import { OptionalStringInput } from '@/modeler/views/inspector/OptionalStringInput';
import { ExpressionInput } from '@/modeler/views/inspector/ExpressionInput';
import { ReadonlyInput } from '@/modeler/views/inspector/ReadonlyInput';
import { SchemaEditor } from '@/modeler/views/inspector/SchemaEditor';

/**
 * Input-component registry for the inspector — the one place that maps an
 * editor *name* to a React component. Which editor an attribute wants is the
 * schema's call, never this file's: an attribute names one in `meta.editor`,
 * or its value type names one for every attribute of that type (`typeEditor`,
 * resolved by the catalog through any body wrapper).
 *
 * Precedence:
 *
 *   1. `meta.readonly` — display-only, whatever the type,
 *   2. an explicit `meta.editor` on the attribute,
 *   3. shape fallbacks (optional string, string list),
 *   4. enum / boolean,
 *   5. the editor the value type declares,
 *   6. `StringInput`.
 *
 * Adding an editor means registering it here and naming it from a schema —
 * no type name is written down on this side.
 */

const MarkdownStringInput = (inputProps: any) => <StringInput {...inputProps} isMarkdown />;

/** Editors addressable by name from schema `meta.editor`. */
const INPUT_BY_EDITOR_NAME: Record<string, any> = {
  'csvw-table': SchemaEditor,
  'code': CodeEditor,
  'markdown': MarkdownStringInput,
  'checklist': ChecklistInput,
};

export function pickInput(attrDef: AttributeSpec) {
  if (attrDef.meta?.readonly) return ReadonlyInput;
  // Every expression renders the same way, wherever it lives.
  if (attrDef.meta?.expression) return ExpressionInput;

  const named = attrDef.meta?.editor ? INPUT_BY_EDITOR_NAME[attrDef.meta.editor] : undefined;
  if (named) return named;

  const declaredType = attrDef.type || 'String';
  const isStringList = attrDef.isMany === true
    && (declaredType === 'String' || declaredType.endsWith(':MarkdownString'));
  const isOptionalString = attrDef.meta?.optional === true && declaredType === 'String';

  if (isOptionalString) return OptionalStringInput;
  if (isStringList) return ArrayInput;
  if (attrDef.isEnum) return EnumInput;
  if (declaredType === 'Boolean') return BooleanInput;

  return (attrDef.typeEditor ? INPUT_BY_EDITOR_NAME[attrDef.typeEditor] : undefined) ?? StringInput;
}
