/**
 * A reporting guideline, as this skill models one: its name, and the documents it asks of a study that the diagram can
 * draw. A guideline is one module exporting one {@link Guideline}, listed in `guidelines.ts`; nothing else names it.
 */
import type { Editor } from '@modeler/editor/port';

/** A document as drawn, or the sentence saying why this study has none. */
export type Drawn = { svg: string } | { unavailable: string };

export type GuidelineDocument = {
  /** Unique within its guideline; with the guideline's id it names the download (`consort-2025-flow`). */
  id: string;
  /** The guideline's name for it: `Participant flow`. */
  label: string;
  /** One sentence on what it shows and what it reads off the diagram. */
  description: string;
  /** Drawn from the study as it stands, counts and all; it changes nothing in it. */
  draw(modeler: Pick<Editor, 'study'>): Drawn;
};

export type Guideline = {
  /** `consort-2025`: lowercase, with the edition, so two editions of one guideline can sit side by side. */
  id: string;
  /** `CONSORT 2025`. */
  name: string;
  /** The guideline's scope: `Reports of randomised trials`. */
  scope: string;
  /** Where the statement is published. */
  url: string;
  documents: GuidelineDocument[];
};
