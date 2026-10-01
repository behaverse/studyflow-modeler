/**
 * A shape before it exists, described as data: what the palette, a click-append, a replace or an AI asks for.
 * Its prototype is sized to its type's default, for the rules to judge and a ghost to draw, before the mutator
 * mints it.
 */

import { categoryOf, isExpandable, type NodeCategory } from '@core/document/outline.ts';
import { getDefaults } from '@core/element/index.ts';
import type { Element, StudyModel, Value } from '@core/model/index.ts';
import { foldTyped } from '@core/model/yaml.ts';
import { getCatalog, hasCatalog } from '@core/notation/index.ts';

import { mint } from '@canvas/study/elements.ts';
import type { AddShapeSpec } from '@canvas/study/mutator.ts';
import type { RuleElement } from '@canvas/study/rules.ts';
import type { Bounds, Point } from '@canvas/study/scene.ts';
import { EXPANDED_SIZE } from '@canvas/study/tree.ts';

/** A new shape: a BPMN type, typed further by a schema's extension. */
export interface NewShape {
  /** `bpmn:Task`, `bpmn:StartEvent`, … */
  type: string;
  /** A schema's type that extends `type`: a cognitive task on `bpmn:ChoreographyTask`, say. */
  extension?: string;
  /** A container drawn open, its contents in view; one is born closed unless this says otherwise. */
  expanded?: boolean;
  name?: string;
  /** Set on its element; `eventDefinitions: [{ type }]` makes an event variant. */
  attributes?: Record<string, unknown>;
}

/** A new element: a shape, or a template's elements, by the id the catalog lists the template under. */
export type NewElement = NewShape | { template: string };

/** A detached shape: judged by the rules before it exists, drawn by the preview. */
export interface CreatePrototype extends RuleElement {
  readonly kind: 'prototype';
  readonly type: string;
  /** The element a ghost draws, never filed. */
  element?: Element;
  width: number;
  height: number;
  extensionType?: string;
  attrs?: Record<string, unknown>;
  isExpanded?: boolean;
}

const DEFAULT_SIZES: Readonly<Record<NodeCategory, { width: number; height: number }>> = {
  event: { width: 36, height: 36 },
  task: { width: 100, height: 80 },
  gateway: { width: 50, height: 50 },
  data: { width: 36, height: 50 },
  choreography: { width: 100, height: 80 },
  group: { width: 300, height: 200 },
  annotation: { width: 100, height: 30 },
  participant: { width: 600, height: 250 },
  unknown: { width: 100, height: 80 },
};

export function defaultSizeFor(type: string, isExpanded?: boolean): { width: number; height: number } {
  if (isExpanded && isExpandable(type)) return { ...EXPANDED_SIZE };
  if (type === 'bpmn:Lane') return { width: 600, height: 120 };
  return { ...DEFAULT_SIZES[categoryOf(type)] };
}

/** Whether a container is drawn open: only when `shape` says so; `undefined` for what holds no contents. */
function expandedOf(shape: NewShape): boolean | undefined {
  return isExpandable(shape.type) ? shape.expanded === true : undefined;
}

/** What `shape` sets on its element: its attributes, and its name. */
function attributesOf(shape: NewShape): Record<string, unknown> | undefined {
  if (shape.name === undefined) return shape.attributes && { ...shape.attributes };
  return { ...shape.attributes, name: shape.name };
}

/** `shape` before it exists, at its type's default size; `draft` is an element for a ghost to draw. */
export function prototypeOf(shape: NewShape, draft?: Element): CreatePrototype {
  const isExpanded = expandedOf(shape);
  const attrs = attributesOf(shape);
  return {
    kind: 'prototype',
    type: shape.type,
    ...defaultSizeFor(shape.type, isExpanded),
    ...(draft ? { element: draft } : {}),
    ...(shape.extension ? { extensionType: shape.extension } : {}),
    ...(attrs ? { attrs } : {}),
    ...(isExpanded !== undefined ? { isExpanded } : {}),
  };
}

/** An element of `shape` for a ghost to draw: minted, never filed. */
export function draftOf(model: StudyModel, shape: NewShape): Element {
  return mintTyped(model, shape.type, attributesOf(shape) ?? {}, shape.extension);
}

/**
 * A new element of `type` with `attributes`, typed by the schema type `extension` when there is one: the extension's
 * defaults where its attributes live (a trait's on the element, a type's on its entry), written as the file spells
 * it (a type the element is, rather than an entry, where it can be).
 */
export function mintTyped(model: StudyModel, type: string, attributes: Record<string, unknown>, extension?: string): Element {
  const element = mint(type, attributes);
  if (!extension) return element;
  const declared = hasCatalog() ? getCatalog().getType(extension) : undefined;
  if (declared?.style !== 'trait') element.extensionElements = [{ type: extension }];
  // An event type may say which event it is (a rest is a timer): a new one gets that definition.
  const definition = declared?.meta?.eventDefinition;
  if (definition && !('eventDefinitions' in attributes)) element.eventDefinitions = [structuredClone(definition) as Element];
  // The defaults are named as the schema declares them (`cognitive:eyes`); the study holds them by local name.
  for (const [qualified, value] of Object.entries(getDefaults(extension))) {
    const name = qualified.slice(qualified.indexOf(':') + 1);
    if (!(name in attributes)) model.setAttribute(element, name, value as Value);
  }
  return foldTyped(model.metamodel, element);
}

/** What the mutator mints for `prototype` at `center`, under the id given when there is one. */
export function shapeSpec(prototype: CreatePrototype, center: Point, id?: string): AddShapeSpec {
  return {
    type: prototype.type,
    bounds: boundsFor(prototype, center),
    ...(prototype.extensionType ? { extensionType: prototype.extensionType } : {}),
    ...(prototype.attrs ? { attrs: prototype.attrs } : {}),
    ...(prototype.isExpanded !== undefined ? { isExpanded: prototype.isExpanded } : {}),
    ...(id ? { id } : {}),
  };
}

export function boundsFor(prototype: CreatePrototype, center: Point): Bounds {
  return { x: center.x - prototype.width / 2, y: center.y - prototype.height / 2, width: prototype.width, height: prototype.height };
}
