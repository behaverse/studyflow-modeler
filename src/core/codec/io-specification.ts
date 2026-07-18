/**
 * Standard-BPMN I/O lowering.
 *
 * Studyflow's compact form binds a wire to a callable parameter with one
 * extension attribute (`exec:parameter` on the data input association,
 * defaulting to the wired element's name) and treats the step's return value
 * as the implicit source of every output wire. BPMN 2.0 spells the same
 * facts structurally: the activity declares an `ioSpecification` whose named
 * `bpmn:DataInput`s *are* the parameters (each input association targets
 * one), a `bpmn:DataOutput` carries the produced value (each output
 * association sources from it), and `inputSet`/`outputSet` group them.
 *
 * The two forms are losslessly interchangeable, and each stays where it
 * serves best:
 *
 * - **lower** (`lowerIoSpecification` / `toStandardBpmnXml`): applied when
 *   `.bpmn` XML leaves the app, so exported files are complete standard BPMN
 *   with no binding extension attributes.
 * - **fold** (`foldIoSpecification`, run by `xmlToStudyflow` and the XML
 *   import boundary): the inverse — DataInput names collapse back to
 *   `parameter` (omitted when equal to the wired element's name), the
 *   synthesized structure disappears, and the canvas/YAML keep the compact
 *   form.
 *
 * Field extraction on a wire is BPMN's own `transformation` expression and
 * needs no lowering — it is already the standard form.
 *
 * An activity whose multi-instance marker references its ioSpecification
 * (`loopDataInputRef`, `inputDataItem`, ...) or whose ioSpecification
 * declares I/O that no drawn association carries is left untouched by the
 * fold: the codec serializes the native structure as-is rather than dropping
 * declared facts.
 */

/** Sanitize a binding name into an XML id fragment. */
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

/** The effective binding name of an input wire in the compact form. */
function effectiveParameter(assoc: any): string {
  const source = assoc.sourceRef?.[0];
  return assoc.get?.('parameter') || source?.name || source?.id || 'input';
}

/**
 * LOWER: synthesize the standard `ioSpecification` structure on every wired
 * activity and retarget its associations natively. Mutates the tree.
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
      const name = effectiveParameter(assoc);
      let id = `${activity.id}_in_${idSlug(name)}`;
      for (let n = 2; usedIds.has(id); n += 1) id = `${activity.id}_in_${idSlug(name)}_${n}`;
      usedIds.add(id);
      const dataInput = model.create('bpmn:DataInput', { id, name });
      dataInputs.push(dataInput);
      assoc.set('targetRef', dataInput);
      assoc.set('parameter', undefined);
    }

    const dataOutputs: any[] = [];
    if (outputs.length > 0) {
      const result = model.create('bpmn:DataOutput', { id: `${activity.id}_result`, name: 'result' });
      dataOutputs.push(result);
      for (const assoc of outputs) assoc.set('sourceRef', [result]);
    }

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

  forEachProcess(definitions, (process) => forEachActivity(process, (activity) => {
    const io = activity.ioSpecification;
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
    // Declared-but-unwired I/O is a fact the compact form would drop - keep
    // the native structure for such (foreign) files.
    if (referencedInputs.size !== declaredInputs.length || referencedOutputs.size !== declaredOutputs.length) return;

    for (const assoc of activity.dataInputAssociations ?? []) {
      const target = assoc.targetRef;
      if (!target || !declaredInputs.includes(target)) continue;
      const source = assoc.sourceRef?.[0];
      const defaultName = source?.name || source?.id;
      if (target.name && target.name !== defaultName) assoc.set('parameter', target.name);
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

/** `.bpmn` export boundary: XML in, standard-form XML out. */
export async function toStandardBpmnXml(xml: string, moddle: any): Promise<string> {
  const { rootElement } = await moddle.fromXML(xml);
  if (!lowerIoSpecification(rootElement)) return xml;
  return (await moddle.toXML(rootElement, { format: true })).xml;
}

/** XML import boundary: fold standard-form files to the compact form the
 *  canvas and YAML use. Cheap no-op when no ioSpecification is present. */
export async function fromStandardBpmnXml(xml: string, moddle: any): Promise<string> {
  if (!/ioSpecification/i.test(xml)) return xml;
  const { rootElement } = await moddle.fromXML(xml);
  if (!foldIoSpecification(rootElement)) return xml;
  return (await moddle.toXML(rootElement, { format: true })).xml;
}
