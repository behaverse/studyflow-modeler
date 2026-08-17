import { applyXmlPasses } from '@core/document/format';
import type { Moddle } from '@core/element/moddle';

function splitBinding(value: string | undefined): { slot?: string; selection?: string } {
  const text = (value ?? '').trim();
  if (!text) return {};
  const slotOnly = /^(self|\*|[A-Za-z_]\w*)$/.exec(text);
  if (slotOnly) return { slot: slotOnly[1] };
  // `=` splits the halves; `==` belongs to the selection (a comparison).
  const both = /^(self|\*|[A-Za-z_]\w*)\s*=(?!=)\s*(\S.*)$/.exec(text);
  if (both) return { slot: both[1], selection: both[2].trim() };
  return { selection: text };
}

function combineBinding(slot: string | undefined, selection: string | undefined): string | undefined {
  if (slot && selection) return `${slot} = ${selection}`;
  return slot || selection || undefined;
}

function idSlug(name: string): string {
  return name.replace(/[^A-Za-z0-9_]+/g, '_');
}

function forEachActivity(container: any, visit: (activity: any) => void): void {
  for (const el of container?.flowElements ?? []) {
    if (Array.isArray(el.dataInputAssociations) || Array.isArray(el.dataOutputAssociations)) visit(el);
    if (Array.isArray(el.flowElements)) forEachActivity(el, visit);
  }
}

function forEachProcess(definitions: any, visit: (process: any) => void): void {
  for (const root of definitions?.rootElements ?? []) {
    if (Array.isArray(root.flowElements)) visit(root);
  }
}

function defaultSlotFor(assoc: any): string {
  const source = assoc.sourceRef?.[0];
  return source?.name || source?.id || 'input';
}

function effectiveSlot(assoc: any): string {
  return splitBinding(assoc.transformation?.body).slot || defaultSlotFor(assoc);
}

/** Updates the expression element in place rather than recreating it, so its `language` survives. */
function lowerSelection(assoc: any): void {
  const expression = assoc.transformation;
  const { selection } = splitBinding(expression?.body);
  if (selection) expression.set('body', selection);
  else assoc.set('transformation', undefined);
}

export function expandIoSpecification(definitions: any): boolean {
  const model = definitions?.$model;
  if (!model) return false;
  let changed = false;

  forEachProcess(definitions, (process) => forEachActivity(process, (activity) => {
    if (activity.ioSpecification) return;
    const inputs = activity.dataInputAssociations ?? [];
    const outputs = activity.dataOutputAssociations ?? [];
    if (inputs.length === 0 && outputs.length === 0) return;

    const dataInputs: any[] = [];
    const usedIds = new Set<string>();
    for (const assoc of inputs) {
      // An authored target (a `bpmn:Property`) is the diagram's own fact, not ours to rewire.
      if (assoc.targetRef) continue;
      const name = effectiveSlot(assoc);
      let id = `${activity.id}_in_${idSlug(name)}`;
      for (let n = 2; usedIds.has(id); n += 1) id = `${activity.id}_in_${idSlug(name)}_${n}`;
      usedIds.add(id);
      const dataInput = model.create('bpmn:DataInput', { id, name });
      dataInputs.push(dataInput);
      assoc.set('targetRef', dataInput);
      lowerSelection(assoc);
    }

    const dataOutputs: any[] = [];
    const implicitOutputs = outputs.filter((assoc: any) => !(assoc.sourceRef?.length));
    if (implicitOutputs.length > 0) {
      const result = model.create('bpmn:DataOutput', { id: `${activity.id}_result`, name: 'result' });
      dataOutputs.push(result);
      for (const assoc of implicitOutputs) {
        assoc.set('sourceRef', [result]);
        lowerSelection(assoc);
      }
    }
    if (dataInputs.length === 0 && dataOutputs.length === 0) return;

    const inputSet = model.create('bpmn:InputSet', {
      id: `${activity.id}_inputSet`,
      dataInputRefs: [...dataInputs],
    });
    const outputSet = model.create('bpmn:OutputSet', {
      id: `${activity.id}_outputSet`,
      dataOutputRefs: [...dataOutputs],
    });
    const ioSpecification = model.create('bpmn:InputOutputSpecification', {
      id: `${activity.id}_io`,
      dataInputs,
      dataOutputs,
      inputSets: [inputSet],
      outputSets: [outputSet],
    });
    for (const child of [...dataInputs, ...dataOutputs, inputSet, outputSet]) child.$parent = ioSpecification;
    ioSpecification.$parent = activity;
    activity.set('ioSpecification', ioSpecification);
    changed = true;
  }));

  return changed;
}

export function inlineIoSpecification(definitions: any): boolean {
  let changed = false;

  const model = definitions?.$model;

  forEachProcess(definitions, (process) => forEachActivity(process, (activity) => {
    const io = activity.ioSpecification;
    if (!io) return;

    // A multi-instance marker referencing the ioSpecification carries facts the compact form cannot hold.
    const loop = activity.loopCharacteristics;
    if (loop && (loop.loopDataInputRef || loop.loopDataOutputRef || loop.inputDataItem || loop.outputDataItem)) return;

    const declaredInputs: any[] = io.dataInputs ?? [];
    const declaredOutputs: any[] = io.dataOutputs ?? [];
    const referencedInputs = new Set<any>();
    const referencedOutputs = new Set<any>();
    for (const assoc of activity.dataInputAssociations ?? []) {
      if (assoc.targetRef && declaredInputs.includes(assoc.targetRef)) referencedInputs.add(assoc.targetRef);
    }
    for (const assoc of activity.dataOutputAssociations ?? []) {
      for (const source of assoc.sourceRef ?? []) {
        if (declaredOutputs.includes(source)) referencedOutputs.add(source);
      }
    }
    // Declared-but-unassociated I/O is a fact the compact form would drop.
    if (referencedInputs.size !== declaredInputs.length || referencedOutputs.size !== declaredOutputs.length) return;

    for (const assoc of activity.dataInputAssociations ?? []) {
      const target = assoc.targetRef;
      if (!target || !declaredInputs.includes(target)) continue;
      const slot = target.name && target.name !== defaultSlotFor(assoc) ? target.name : undefined;
      const selection = assoc.transformation?.body || undefined;
      const fused = combineBinding(slot, selection);
      if (fused && assoc.transformation) {
        assoc.transformation.set('body', fused);
      } else if (fused && model) {
        const expression = model.create('bpmn:FormalExpression', { body: fused });
        expression.$parent = assoc;
        assoc.set('transformation', expression);
      } else if (!fused) {
        assoc.set('transformation', undefined);
      }
      assoc.set('targetRef', undefined);
    }
    for (const assoc of activity.dataOutputAssociations ?? []) {
      const remaining = (assoc.sourceRef ?? []).filter((source: any) => !declaredOutputs.includes(source));
      if (remaining.length !== (assoc.sourceRef ?? []).length) assoc.set('sourceRef', remaining);
    }
    activity.set('ioSpecification', undefined);
    changed = true;
  }));

  return changed;
}

export async function toStandardBpmnXml(xml: string, moddle: Moddle): Promise<string> {
  return applyXmlPasses(xml, moddle, [expandIoSpecification]);
}

export async function fromStandardBpmnXml(xml: string, moddle: Moddle): Promise<string> {
  return applyXmlPasses(xml, moddle, [inlineIoSpecification]);
}
