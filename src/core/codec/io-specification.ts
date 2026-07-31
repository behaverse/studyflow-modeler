/**
 * Standard-BPMN I/O lowering.
 *
 * Studyflow's compact form carries one `transformation` expression per data
 * association — `slot = selection`, each half optional (see the studyflow schema).
 * BPMN 2.0 spells the same facts structurally: the slot is the name of a
 * declared `bpmn:DataInput` the association targets (the activity's
 * `ioSpecification`), the produced value is a `bpmn:DataOutput` every output
 * association sources from, and the selection is BPMN's own `transformation`
 * expression on the association.
 *
 * The two forms are losslessly interchangeable, and each stays where it
 * serves best:
 *
 * - **lower** (`lowerIoSpecification` / `toStandardBpmnXml`): applied to
 *   every XML that leaves the app — `.bpmn` exports, the YAML→XML projection,
 *   the payload a figure embeds — so saved files are complete standard BPMN
 *   with no binding extension attributes.
 * - **fold** (`foldIoSpecification`, run by `xmlToStudyflow` and the XML
 *   import boundary): the inverse — DataInput names collapse back to the
 *   binding's slot (omitted when equal to the associated element's name),
 *   native `transformation` expressions collapse to its selection, the
 *   synthesized structure disappears, and the canvas/YAML keep the compact
 *   form.
 *
 * An activity whose multi-instance marker references its ioSpecification
 * (`loopDataInputRef`, `inputDataItem`, ...) or whose ioSpecification
 * declares I/O that no drawn association carries is left untouched by the
 * fold: the codec serializes the native structure as-is rather than dropping
 * declared facts.
 */

/** The two halves of a compact transformation body: `slot = selection`, each optional. */
export function splitBinding(value: string | undefined): { slot?: string; selection?: string } {
  const text = (value ?? '').trim();
  if (!text) return {};
  const slotOnly = /^(self|\*|[A-Za-z_]\w*)$/.exec(text);
  if (slotOnly) return { slot: slotOnly[1] };
  // `=` splits the halves; `==` belongs to the selection (a comparison).
  const both = /^(self|\*|[A-Za-z_]\w*)\s*=(?!=)\s*(\S.*)$/.exec(text);
  if (both) return { slot: both[1], selection: both[2].trim() };
  return { selection: text };
}

/** The one compact transformation body back from its halves. */
export function combineBinding(slot: string | undefined, selection: string | undefined): string | undefined {
  if (slot && selection) return `${slot} = ${selection}`;
  return slot || selection || undefined;
}

/** Sanitize a slot name into an XML id fragment. */
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

/** The effective slot of an input association in the compact form. */
function effectiveSlot(assoc: any): string {
  const source = assoc.sourceRef?.[0];
  return splitBinding(assoc.transformation?.body).slot || source?.name || source?.id || 'input';
}

/** Narrow the compact transformation to its selection half — the slot has
 *  moved into the synthesized DataInput's name. A slot-only body leaves no
 *  expression behind. The element (and its `language`) is kept, not
 *  recreated. */
function lowerSelection(_model: any, assoc: any): void {
  const expression = assoc.transformation;
  const { selection } = splitBinding(expression?.body);
  if (selection) expression.set('body', selection);
  else assoc.set('transformation', undefined);
}

/**
 * LOWER: synthesize the standard `ioSpecification` structure on every associated
 * activity, retarget its associations natively, and turn each binding's
 * selection into BPMN's own `transformation`. Mutates the tree.
 */
export function lowerIoSpecification(definitions: any): boolean {
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
      // An authored target (a `bpmn:Property` the value lands in) is a fact of
      // the diagram, not ours to rewire onto a synthesized DataInput.
      if (assoc.targetRef) continue;
      const name = effectiveSlot(assoc);
      let id = `${activity.id}_in_${idSlug(name)}`;
      for (let n = 2; usedIds.has(id); n += 1) id = `${activity.id}_in_${idSlug(name)}_${n}`;
      usedIds.add(id);
      const dataInput = model.create('bpmn:DataInput', { id, name });
      dataInputs.push(dataInput);
      assoc.set('targetRef', dataInput);
      lowerSelection(model, assoc);
    }

    const dataOutputs: any[] = [];
    const implicitOutputs = outputs.filter((assoc: any) => !(assoc.sourceRef?.length));
    if (implicitOutputs.length > 0) {
      const result = model.create('bpmn:DataOutput', { id: `${activity.id}_result`, name: 'result' });
      dataOutputs.push(result);
      for (const assoc of implicitOutputs) {
        assoc.set('sourceRef', [result]);
        lowerSelection(model, assoc);
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

/**
 * FOLD: collapse a standard `ioSpecification` back to the compact form.
 * Mutates the tree; the inverse of {@link lowerIoSpecification}.
 */
export function foldIoSpecification(definitions: any): boolean {
  let changed = false;

  const model = definitions?.$model;

  forEachProcess(definitions, (process) => forEachActivity(process, (activity) => {
    const io = activity.ioSpecification;
    // Without the structure there is nothing to fold: a native selection is
    // already the compact spelling (the slot half only exists with a
    // synthesized DataInput to carry it).
    if (!io) return;

    // A multi-instance marker referencing the ioSpecification carries facts
    // the compact form cannot hold - keep the native structure.
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
    // Declared-but-unassociated I/O is a fact the compact form would drop - keep
    // the native structure for such (foreign) files.
    if (referencedInputs.size !== declaredInputs.length || referencedOutputs.size !== declaredOutputs.length) return;

    for (const assoc of activity.dataInputAssociations ?? []) {
      const target = assoc.targetRef;
      if (!target || !declaredInputs.includes(target)) continue;
      const source = assoc.sourceRef?.[0];
      const defaultName = source?.name || source?.id;
      const slot = target.name && target.name !== defaultName ? target.name : undefined;
      // Rejoin the halves into the compact body; keep (or create) the
      // expression element so its `language` rides along.
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
      // An output's selection is already the compact body — nothing to rejoin.
    }
    activity.set('ioSpecification', undefined);
    changed = true;
  }));

  return changed;
}

/** `.bpmn` export boundary: XML in, standard-form XML out. */
export async function toStandardBpmnXml(xml: string, moddle: any): Promise<string> {
  const { rootElement } = await moddle.fromXML(xml);
  if (!lowerIoSpecification(rootElement)) return xml;
  return (await moddle.toXML(rootElement, { format: true })).xml;
}

/** XML import boundary: fold standard-form files to the compact form the
 *  canvas and YAML use. Cheap no-op when neither spelling is present. */
export async function fromStandardBpmnXml(xml: string, moddle: any): Promise<string> {
  if (!/ioSpecification|:transformation[\s>]/i.test(xml)) return xml;
  const { rootElement } = await moddle.fromXML(xml);
  if (!foldIoSpecification(rootElement)) return xml;
  return (await moddle.toXML(rootElement, { format: true })).xml;
}
