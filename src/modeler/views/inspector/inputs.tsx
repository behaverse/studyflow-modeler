import type { AttributeSpec } from '@/core/catalog';
import { StringInput } from '@/modeler/views/inspector/StringInput';
import { CodeEditor } from '@/modeler/views/inspector/CodeEditor';
import { BooleanInput } from '@/modeler/views/inspector/BooleanInput';
import { EnumInput } from '@/modeler/views/inspector/EnumInput';
import { ArrayInput } from '@/modeler/views/inspector/ArrayInput';
import { OptionalStringInput } from '@/modeler/views/inspector/OptionalStringInput';
import { ReadonlyInput } from '@/modeler/views/inspector/ReadonlyInput';
import { SchemaEditor } from '@/modeler/views/inspector/SchemaEditor';

/**
 * Input-component registry for the inspector. An attribute picks its editor
 * in precedence order:
 *
 *   1. an explicit `meta.editor` name declared in the schema,
 *   2. its resolved value type (enum, body-wrapper drilling applied),
 *   3. shape fallbacks (optional string, string list),
 *   4. `StringInput`.
 *
 * Adding an editor means registering it here — nothing else changes.
 */

const MarkdownStringInput = (inputProps: any) => <StringInput {...inputProps} isMarkdown />;

/** Editors addressable by name from schema `meta.editor`. */
const INPUT_BY_EDITOR_NAME: Record<string, any> = {
  'csvw-table': SchemaEditor,
  'code': CodeEditor,
};

// `Enum` is a synthetic type produced by `resolveInputType` for enum-typed attributes.
const INPUT_BY_TYPE: Record<string, any> = {
  Boolean: BooleanInput,
  Enum: EnumInput,
  'studyflow:Schema': CodeEditor,
  'studyflow:MarkdownString': MarkdownStringInput,
  'studyflow:YAMLString': CodeEditor,
};

/** The catalog precompiles enum membership and body-wrapper types (e.g. a
 *  `cognitive:Configurations` wrapper around `studyflow:YAMLString` renders
 *  with the same editor as a direct `studyflow:YAMLString` attribute). */
function resolveInputType(attrDef: AttributeSpec): string {
  const declaredType = attrDef.type || 'String';
  if (attrDef.isEnum) return 'Enum';
  if (attrDef.bodyType && INPUT_BY_TYPE[attrDef.bodyType]) return attrDef.bodyType;
  return declaredType;
}

export function pickInput(attrDef: AttributeSpec) {
  // Engine-written fields (`meta.readonly`) are display-only, whatever their type.
  if (attrDef.meta?.readonly) return ReadonlyInput;

  const editorName = attrDef.meta?.editor;
  const named = editorName ? INPUT_BY_EDITOR_NAME[editorName] : undefined;
  if (named) return named;

  const declaredType = attrDef.type || 'String';
  const isStringList = attrDef.isMany === true
    && (declaredType === 'String' || declaredType.endsWith(':MarkdownString'));
  const isOptionalString = attrDef.meta?.optional === true && declaredType === 'String';

  if (isOptionalString) return OptionalStringInput;
  if (isStringList) return ArrayInput;
  return INPUT_BY_TYPE[resolveInputType(attrDef)] ?? StringInput;
}
