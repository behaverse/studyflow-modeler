import { layoutProcess } from 'bpmn-auto-layout';

/**
 * Give a diagram enough geometry for the canvas to render it.
 *
 * bpmn-js draws from BPMN Diagram Interchange (the `bpmndi:BPMNDiagram`
 * subtree); a document without it aborts import with "no diagram to display".
 * Hand-written `.studyflow` files describe only the flow graph — nodes, edges,
 * and their studyflow/cognitive extensions — so they carry no layout, and the
 * codec keeps them that way (geometry is a view concern, not part of the
 * lossless YAML <-> XML mapping).
 *
 * `ensureDiagramLayout` bridges that gap at the import boundary: when the XML
 * has no DI, `bpmn-auto-layout` synthesizes a left-to-right layout. It only
 * *adds* the `bpmndi` tree, so every semantic element and extension wrapper
 * survives untouched. Documents that already ship geometry are returned as-is,
 * so authored layouts are never disturbed.
 */

/**
 * True when `xml` already carries a `bpmndi:BPMNDiagram`. Prefix-agnostic: the
 * DI namespace is conventionally bound to `bpmndi`, but the check matches the
 * local name under any prefix so a non-standard binding still counts as DI.
 */
export function hasDiagramInterchange(xml: string): boolean {
  return /<(?:[\w.-]+:)?BPMNDiagram[\s/>]/.test(xml);
}

/** Return `xml` with DI, synthesizing a layout when it has none. */
export async function ensureDiagramLayout(xml: string): Promise<string> {
  if (hasDiagramInterchange(xml)) return xml;
  try {
    return await layoutProcess(xml);
  } catch (err) {
    // Auto-layout covers the process/collaboration forms the canvas hosts; if
    // it cannot lay a particular document out, hand the original back so the
    // importer surfaces its own (more specific) error instead of this one.
    console.warn('Auto-layout failed for a diagram without DI; importing as-is.', err);
    return xml;
  }
}
