import { parseStudyflow, type ParsedStudy } from '@/lib/core/parsers/studyflow';
import type { FlowNode, SequenceFlow } from '@/lib/core/flow';

/** Parsed studyflow document. Static BPMN structure only; no runtime state.
 *
 *  A Studyflow can be inspected and validated without a participant or a run.
 *  Pair it with a {@link Session} (see ./session) to traverse and execute it. */
export class Studyflow {
  businessObject: any;
  flowNodes: Map<string, FlowNode>;
  sequenceFlows: Map<string, SequenceFlow>;
  startId?: string;
  /** SHA-256 hex of the raw studyflow XML. Stamped onto downstream events so
   *  every record can be pinned to the exact source document. */
  studyflowHash?: string;

  static async parse(
    xml: string,
    schemas: Record<string, any>,
    studyflowHash?: string,
  ): Promise<Studyflow> {
    return new Studyflow(await parseStudyflow(xml, schemas), studyflowHash);
  }

  constructor(data: ParsedStudy, studyflowHash?: string) {
    this.businessObject = data.businessObject;
    this.flowNodes = data.flowNodes;
    this.sequenceFlows = data.sequenceFlows;
    this.startId = data.startId;
    this.studyflowHash = studyflowHash;
  }

  /** BDM `study_id`. Sourced from the BPMN root's `id` attribute. */
  get studyId(): string | undefined {
    const id = this.businessObject?.id;
    return typeof id === 'string' && id.length > 0 ? id : undefined;
  }

  /** Identifier for this specific studyflow document. Sourced from the BPMN
   *  root's `name` attribute. Falls back to `studyId` when unset. */
  get studyflowId(): string | undefined {
    const name = this.businessObject?.name;
    return typeof name === 'string' && name.length > 0 ? name : this.studyId;
  }
}
