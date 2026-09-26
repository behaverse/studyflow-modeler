/**
 * A shape before it exists: what the palette, a click-append or a replace describes, sized to its type's
 * default, and judged by the rules before the mutator mints it.
 */

import { categoryOf, type NodeCategory } from '@core/document/outline.ts';

import type { RuleElement } from '@canvas/study/rules.ts';
import type { Bounds, ModdleObject, Point } from '@canvas/study/scene.ts';
import { EXPANDED_SIZE, isExpandable } from '@canvas/study/tree.ts';

export interface ShapeDescriptor {
  type: string;
  extensionType?: string;
  attrs?: Record<string, unknown>;
  /** A business object the host built already; the drop files this one. */
  businessObject?: ModdleObject;
  width?: number;
  height?: number;
  isExpanded?: boolean;
}

/** A detached shape: judged by the rules before it exists, drawn by the preview. */
export interface CreatePrototype extends RuleElement {
  readonly kind: 'prototype';
  readonly type: string;
  businessObject?: ModdleObject;
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

export function createShape(descriptor: ShapeDescriptor | CreatePrototype): CreatePrototype {
  if ('kind' in descriptor && descriptor.kind === 'prototype') return descriptor;
  const spec = descriptor as ShapeDescriptor;
  const size = defaultSizeFor(spec.type, spec.isExpanded);
  const prototype: CreatePrototype = {
    kind: 'prototype',
    type: spec.type,
    width: spec.width ?? size.width,
    height: spec.height ?? size.height,
  };
  if (spec.businessObject) prototype.businessObject = spec.businessObject;
  if (spec.extensionType) prototype.extensionType = spec.extensionType;
  if (spec.attrs) prototype.attrs = { ...spec.attrs };
  if (spec.isExpanded !== undefined) prototype.isExpanded = spec.isExpanded;
  return prototype;
}

export function boundsFor(prototype: CreatePrototype, center: Point): Bounds {
  return { x: center.x - prototype.width / 2, y: center.y - prototype.height / 2, width: prototype.width, height: prototype.height };
}
